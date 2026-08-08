import { UniqueConstraintError } from 'sequelize';
import { EsaviCase, HealthFacility, Patient } from '../models';
import { AppError, esaviDecrypt, formatCaseCode, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateEsaviCaseInput } from '../types';

// The case code is not atomic by construction: two simultaneous inserts on the same facility and
// date read the same MAX. The UNIQUE constraint is the authority, and the service just recomputes
// and tries again — three times, and then it gives up with a 409
const CASE_CODE_MAX_ATTEMPTS = 3;

// The encrypted columns of the included patient. healthSystemCode is stored in clear text
const PATIENT_PII_FIELDS = ['firstName', 'lastName', 'documentNumber'];

// A report date is a calendar date: only the YYYY-MM-DD part is kept, so a full ISO timestamp
// coming from the client cannot shift the day — and that day travels inside the case code
const normalizeIsoDate = (value: string): string => value.trim().slice(0, 10);

const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const normalizeCountryIsoCode = (value: string): string => value.trim().toUpperCase();
const normalizeOrganization = (value: string): string => toTitleCase(value.trim());

const PATIENT_INCLUDE = {
    model: Patient,
    as: 'patient',
    attributes: ['patientId', 'firstName', 'lastName', 'documentNumber', 'healthSystemCode']
};

const HEALTH_FACILITY_INCLUDE = {
    model: HealthFacility,
    as: 'healthFacility',
    attributes: ['healthFacilityId', 'localCode', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The two raw foreign keys go with
// it: the response carries the resolved patient and healthFacility objects instead
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'patientId', 'healthFacilityId'] };

const decryptPatient = (plain: Record<string, unknown>) => {
    const patient = plain.patient as Record<string, unknown> | null | undefined;
    if( !patient ) return plain;
    for( const field of PATIENT_PII_FIELDS ) {
        if( !( field in patient ) ) continue;
        const value = patient[field];
        patient[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

const toEsaviCaseResponse = (esaviCase: EsaviCase) => {
    const plain = esaviCase.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.patientId;
    delete plain.healthFacilityId;
    return decryptPatient(plain);
}

// The read the write operations share to build their response
const findEsaviCaseWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { caseId: id } : { caseId: id, isActive: true };
    return await EsaviCase.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [PATIENT_INCLUDE, HEALTH_FACILITY_INCLUDE]
    });
}

// Both foreign keys are NOT NULL with ON DELETE RESTRICT, which only protects against physical
// deletes — the triggers already forbid those. Nothing in the DDL stops a case from pointing at a
// deactivated row, so the check is the service's alone. Shared by 001 and 004 so the two
// conditions cannot drift apart; the operation code travels in so the AppError keeps it
const assertPatientIsValid = async (patientId: string, op: string, lang: string) => {
    const patient = await Patient.findOne({
        where: { patientId, isActive: true },
        attributes: ['patientId']
    });
    if( !patient ) {
        throw new AppError(getMessage('esaviCase.patientNotFound', lang), 404, `CASE_${ op }_PATIENT_NOT_FOUND`);
    }
}

const assertHealthFacilityIsValid = async (healthFacilityId: string, op: string, lang: string) => {
    const healthFacility = await HealthFacility.findOne({
        where: { healthFacilityId, isActive: true },
        attributes: ['healthFacilityId', 'localCode']
    });
    if( !healthFacility ) {
        throw new AppError(getMessage('esaviCase.healthFacilityNotFound', lang), 404, `CASE_${ op }_FACILITY_NOT_FOUND`);
    }
    return healthFacility;
}

// The next sequence for a facility and a date. The query does NOT filter by isActive: a
// deactivated case keeps its code, and reusing it would violate UQ_esaviCase_caseCode.
// MAX is read lexicographically — the fixed four-digit width with leading zeros makes the
// alphabetical order match the numeric one, so no substring or cast is needed in SQL
const nextCaseSequence = async (healthFacilityId: string, reportDate: string): Promise<number> => {
    const maxCaseCode = await EsaviCase.max<string | null, EsaviCase>('caseCode', {
        where: { healthFacilityId, reportDate }
    });
    if( !maxCaseCode ) return 1;
    const suffix = String(maxCaseCode).split('-').pop();
    const currentSequence = Number.parseInt(suffix ?? '', 10);
    return Number.isNaN(currentSequence) ? 1 : currentSequence + 1;
}

// Only a UNIQUE violation on caseCode is worth retrying; anything else propagates untouched
const isCaseCodeCollision = (error: unknown): boolean =>
    error instanceof UniqueConstraintError &&
    ( error.errors?.some((item) => item.path === 'caseCode') || String(error.parent?.message ?? '').includes('UQ_esaviCase_caseCode') );

// Create ESAVI Case Service
// Code: ESAVI-CASE-001
// caseCode is generated here and never received: whatever the client sent under that name is
// ignored without an error. If the client chose it, two operators would compete for the same
// code and the 409 would land on whoever arrived second, for a mistake they did not make
const createEsaviCaseService = async (data: CreateEsaviCaseInput, authUser: AuthUser | undefined, lang: string) => {
    // Resolved here and not left to the DEFAULT current_date of the table: the case code needs
    // the date BEFORE the insert
    const reportDate = data.reportDate ? normalizeIsoDate(data.reportDate) : todayIsoDate();

    await assertPatientIsValid(data.patientId, '001', lang);
    const healthFacility = await assertHealthFacilityIsValid(data.healthFacilityId, '001', lang);

    // 409 and not 400: the client's body is correct, what blocks the insert is the state of a
    // referenced resource. No fallback prefix is invented — a made up prefix would stop
    // identifying the facility, which is exactly what the format promises
    const localCode = healthFacility.localCode?.trim();
    if( !localCode ) {
        throw new AppError(getMessage('esaviCase.facilityLocalCodeMissing', lang), 409, 'CASE_001_LOCALCODE_MISSING');
    }

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-001',
        detail: 'ESAVI Case created by service'
    };
    const values = {
        patientId: data.patientId,
        healthFacilityId: data.healthFacilityId,
        reportDate,
        eventDate: data.eventDate ? normalizeIsoDate(data.eventDate) : null,
        countryIsoCode: data.countryIsoCode ? normalizeCountryIsoCode(data.countryIsoCode) : null,
        reportFillingDate: data.reportFillingDate ? normalizeIsoDate(data.reportFillingDate) : null,
        notificationOrganization: data.notificationOrganization ? normalizeOrganization(data.notificationOrganization) : null,
        details: data.details ? data.details.trim() : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    };

    let newEsaviCase: EsaviCase | null = null;
    for( let attempt = 1; attempt <= CASE_CODE_MAX_ATTEMPTS; attempt++ ) {
        const sequence = await nextCaseSequence(data.healthFacilityId, reportDate);
        const caseCode = formatCaseCode(localCode, reportDate, sequence);
        try {
            newEsaviCase = await EsaviCase.create({ ...values, caseCode });
            break;
        } catch (error) {
            if( !isCaseCodeCollision(error) ) throw error;
            if( attempt === CASE_CODE_MAX_ATTEMPTS ) {
                throw new AppError(getMessage('esaviCase.caseCodeExists', lang), 409, 'CASE_001_CODE_EXISTS', error);
            }
        }
    }

    // Re-read so the response carries the resolved patient and facility, not just their ids
    const createdEsaviCase = newEsaviCase ? await findEsaviCaseWithRelations(newEsaviCase.caseId, true) : null;
    return createdEsaviCase ? toEsaviCaseResponse(createdEsaviCase) : null;
}

export {
    createEsaviCaseService
}
