import { Op, Transaction, UniqueConstraintError, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { Classification, EsaviCase, HealthFacility, Investigation, InvestigationAutopsy, InvestigationSource, Notification, NonSevereNotification, Notifier, Patient, SevereNotification } from '../models';
import { AppError, buildDifferentialUpdate, caseCodePrefix, esaviDecrypt, formatCaseCode, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateEsaviCaseInput, EsaviCaseListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { recalculateClassificationAgesService } from './common/ageRecalculation.service';
import { cascadeSealSatellite } from './common/satelliteCascade.service';

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
const normalizeOrganization = (value: string): string => value.trim().toUpperCase();

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

// The reduced shape drops details, countryIsoCode, reportFillingDate, notificationOrganization and
// appDetails: details is free text with no length limit, and dumping it on every row of a page
// makes the response size unpredictable
const LIST_ATTRIBUTES = ['caseId', 'caseCode', 'reportDate', 'eventDate', 'isActive'];

// A list row needs to name the patient, not to identify them: documentNumber only shows up in the
// full shape of 003
const LIST_PATIENT_INCLUDE = {
    model: Patient,
    as: 'patient',
    attributes: ['patientId', 'firstName', 'lastName', 'healthSystemCode']
};

// Newest report first, breaking ties by code. Without the second criterion the cases of the same
// day come out in an arbitrary order and pagination can repeat or skip rows between pages
const LIST_ORDER: [string, string][] = [['reportDate', 'DESC'], ['caseCode', 'DESC']];

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

const toEsaviCaseListRow = (esaviCase: EsaviCase) => decryptPatient(esaviCase.toJSON() as Record<string, unknown>);

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
// deactivated row, so the check is the service's alone. The operation code travels in so the
// AppError keeps it.
//
// The facility check is shared by 001 and 004, so its two conditions cannot drift apart. The
// patient check is only reachable from 001: patientId is immutable in 004, which no longer reads
// the field at all
const assertPatientIsValid = async (patientId: string, op: string, lang: string) => {
    const patient = await Patient.findOne({
        where: { patientId, isActive: true },
        attributes: ['patientId']
    });
    if( !patient ) {
        throw new AppError(getMessage('esaviCase.patientNotFound', lang), 404, `CASE_${ op }_PATIENT_NOT_FOUND`);
    }
}

// The transaction is optional because 001 writes without one and 004 opens its own
const assertHealthFacilityIsValid = async (healthFacilityId: string, op: string, lang: string, transaction?: Transaction) => {
    const healthFacility = await HealthFacility.findOne({
        where: { healthFacilityId, isActive: true },
        attributes: ['healthFacilityId', 'localCode'],
        transaction
    });
    if( !healthFacility ) {
        throw new AppError(getMessage('esaviCase.healthFacilityNotFound', lang), 404, `CASE_${ op }_FACILITY_NOT_FOUND`);
    }
    return healthFacility;
}

// The next sequence for a facility and a registration date, read from the codes already minted
// with that prefix. The query does NOT filter by isActive: a deactivated case keeps its code, and
// reusing it would violate UQ_esaviCase_caseCode. MAX is read lexicographically — the fixed
// four-digit width with leading zeros makes the alphabetical order match the numeric one, so no
// substring or cast is needed in SQL.
//
// It matches on the code prefix and not on a column of the row: the registration date is frozen
// inside the code, so no later update can move a row out of the set this MAX looks at. Filtering
// by healthFacilityId instead would reopen that hole, and it is redundant anyway — localCode is
// UNIQUE, so the prefix already names one facility, which is exactly what UQ_esaviCase_caseCode
// protects
const nextCaseSequence = async (codePrefix: string): Promise<number> => {
    const maxCaseCode = await EsaviCase.max<string | null, EsaviCase>('caseCode', {
        where: { caseCode: { [Op.like]: `${ codePrefix }%` } }
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
    // Resolved here and not left to the DEFAULT current_date of the table, so the row and the
    // response agree on the same value
    const reportDate = data.reportDate ? normalizeIsoDate(data.reportDate) : todayIsoDate();

    // The date that goes into the code is the one the case is registered on, never reportDate:
    // reportDate can still be corrected through 004, and a code minted from a field that can
    // change would end up naming a day the row no longer claims. Registration happens once
    const registrationDate = todayIsoDate();

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

    const codePrefix = caseCodePrefix(localCode, registrationDate);

    let newEsaviCase: EsaviCase | null = null;
    for( let attempt = 1; attempt <= CASE_CODE_MAX_ATTEMPTS; attempt++ ) {
        const sequence = await nextCaseSequence(codePrefix);
        const caseCode = formatCaseCode(localCode, registrationDate, sequence);
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

// The three filters are accumulated with AND, and each one is optional. A filter pointing at a
// row that does not exist yields an empty page, never a 404: searching for something absent is an
// empty search, not a missing resource
const buildListWhere = (filters: EsaviCaseListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.patientId ) where.patientId = filters.patientId;
    if( filters.healthFacilityId ) where.healthFacilityId = filters.healthFacilityId;

    const from = filters.reportDateFrom ? normalizeIsoDate(filters.reportDateFrom) : undefined;
    const to = filters.reportDateTo ? normalizeIsoDate(filters.reportDateTo) : undefined;
    if( from && to ) {
        where.reportDate = { [Op.between]: [from, to] };
    } else if( from ) {
        where.reportDate = { [Op.gte]: from };
    } else if( to ) {
        where.reportDate = { [Op.lte]: to };
    }

    return where as WhereOptions;
}

// Get Active ESAVI Cases Service
// Code: ESAVI-CASE-002A
const getEsaviCasesService = async (
    filters: EsaviCaseListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await EsaviCase.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: [LIST_PATIENT_INCLUDE, HEALTH_FACILITY_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toEsaviCaseListRow) };
}

// Get All ESAVI Cases Service - For Admin
// Code: ESAVI-CASE-002B
const getAllEsaviCasesService = async (
    filters: EsaviCaseListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await EsaviCase.findAndCountAll({
        where: buildListWhere(filters),
        attributes: LIST_ATTRIBUTES,
        include: [LIST_PATIENT_INCLUDE, HEALTH_FACILITY_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toEsaviCaseListRow) };
}

// Get ESAVI Case By ID Service
// Code: ESAVI-CASE-003
const getEsaviCaseByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const esaviCase = await findEsaviCaseWithRelations(id, canViewInactive);
    if( !esaviCase ) {
        throw new AppError(getMessage('esaviCase.notFound', lang), 404, 'CASE_003_NOT_FOUND');
    }
    return toEsaviCaseResponse(esaviCase);
}

// Update ESAVI Case Service
// Code: ESAVI-CASE-004
// Two fields are ignored whether or not they arrive in the body, both without an error:
//
// caseCode, which is NOT regenerated either when healthFacilityId or reportDate change: an
// identifier that changes stops identifying, and any document already printed with the old value
// would be orphaned.
//
// patientId, because a case does not change patient — another one is created. Moving a case to a
// different patient changes the birthDate its classification's age was derived from, and it
// invalidates everything else hanging off the case, not just the age. Closing the path is cheaper
// and safer than propagating it, so the patient check is no longer called from here: the field is
// not even looked at, and an unknown patientId no longer raises a 404 either
const updateEsaviCaseService = async (id: string, data: Partial<CreateEsaviCaseInput>, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        const esaviCase = await EsaviCase.findByPk(id, { transaction });
        if( !esaviCase ) {
            throw new AppError(getMessage('esaviCase.notFound', lang), 404, 'CASE_004_NOT_FOUND');
        }

        if( data.healthFacilityId ) {
            await assertHealthFacilityIsValid(data.healthFacilityId, '004', lang, transaction);
        }

        // Coherence is checked against the RESULTING state, not against the body: validating only what
        // arrives would let through an eventDate incoherent with the reportDate already stored
        const resultingReportDate = data.reportDate !== undefined
            ? ( data.reportDate ? normalizeIsoDate(data.reportDate) : null )
            : esaviCase.reportDate;
        const resultingEventDate = data.eventDate !== undefined
            ? ( data.eventDate ? normalizeIsoDate(data.eventDate) : null )
            : esaviCase.eventDate ?? null;
        if( resultingEventDate && resultingReportDate && resultingEventDate > resultingReportDate ) {
            throw new AppError(getMessage('esaviCase.invalidDateRange', lang), 400, 'CASE_004_INVALID_DATE_RANGE');
        }

        // Differential update: only what really changed reaches the UPDATE. Until now the object was
        // built out of which keys arrived, never comparing them with what was stored, so resending
        // whole the record just read with a GET — the normal use of a form — rewrote every column
        // with its own value. `stored` is the whole row, which is the precondition of the helper,
        // and it compares the three DATEONLY columns by their calendar day
        const stored = esaviCase.get({ plain: true }) as Record<string, unknown>;
        const objectToUpdate = buildDifferentialUpdate(stored, {
            healthFacilityId: data.healthFacilityId ?? undefined,
            reportDate: data.reportDate ? normalizeIsoDate(data.reportDate) : undefined,
            eventDate: data.eventDate !== undefined ? ( data.eventDate ? normalizeIsoDate(data.eventDate) : null ) : undefined,
            countryIsoCode: data.countryIsoCode !== undefined ? ( data.countryIsoCode ? normalizeCountryIsoCode(data.countryIsoCode) : null ) : undefined,
            reportFillingDate: data.reportFillingDate !== undefined ? ( data.reportFillingDate ? normalizeIsoDate(data.reportFillingDate) : null ) : undefined,
            notificationOrganization: data.notificationOrganization !== undefined ? ( data.notificationOrganization ? normalizeOrganization(data.notificationOrganization) : null ) : undefined,
            details: data.details !== undefined ? ( data.details ? data.details.trim() : null ) : undefined
        });

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. The record is returned as it
        // stands, which is the state the client asked for
        if( Object.keys(objectToUpdate).length > 0 ) {
            const currentAppDetails = Array.isArray(esaviCase.appDetails) ? esaviCase.appDetails : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-CASE-004',
                detail: 'ESAVI Case updated by service'
            };
            await esaviCase.update({
                ...objectToUpdate,
                updatedAt: new Date(),
                appDetails: [
                    ...currentAppDetails,
                    newEntry
                ]
            }, { transaction });

            // classification.age is derived from this eventDate, so correcting it leaves the stored
            // age contradicting its own origin unless it is recalculated here. The differential is
            // the trigger: the key only survives it when the resulting value really differs from the
            // stored one, so a PUT that just touches `details` costs no extra query.
            //
            // It runs AFTER the write and inside the same transaction, so the recalculation reads
            // the new eventDate without it having to be passed in. If it throws — a 409 for an event
            // before the patient's birth, a 404 for a missing ageUnit item — the rollback undoes this
            // write too, and the case keeps its previous eventDate
            if( 'eventDate' in objectToUpdate ) {
                await recalculateClassificationAgesService({ caseId: id }, 'ESAVI-CASE-004', authUser, lang, transaction);
            }
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Read outside the transaction, once it is committed: the response is the same whether or not
    // anything changed, so both paths converge here
    const updatedEsaviCase = await findEsaviCaseWithRelations(id, true);
    return updatedEsaviCase ? toEsaviCaseResponse(updatedEsaviCase) : null;
}

// Deactivating a case drags its active notifiers along, inside the same transaction. The
// ON DELETE CASCADE of FK_notifier_case never fires, because TRG_esaviCase_preventPhysicalDelete
// forbids every physical delete of esaviCase, so keeping case and satellites coherent is the
// application's job alone.
//
// One mass update and not N per-row ones: the cascade takes no decision per row, and a case with
// many notifiers would pay for every extra statement inside the transaction. That is why the
// audit entry is appended in SQL — Model.update writes the same value to every row, and the
// history of each notifier has to be preserved, not overwritten.
//
// Only rows already in isActive: true are touched, so a notifier retired by hand beforehand keeps
// its own deletedAt and receives no new entry
// The DDL defaults appDetails to '{}', an object rather than an array, so a row written
// outside the services could hold one. The guard keeps || from folding it into the result
const appendedAppDetails = (entry: AppDetails) => sequelize.literal(
    `CASE WHEN jsonb_typeof("appDetails") = 'array' THEN "appDetails" ELSE '[]'::jsonb END || jsonb_build_array(${ sequelize.escape(JSON.stringify(entry)) }::jsonb)`
) as unknown as AppDetails[];

const cascadeDeactivateNotifiers = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const now = new Date();
    // The method is the code of the operation that deactivated it, not ESAVI-NOTIFIER-005A:
    // that one would suggest somebody retired this notifier individually
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Notifier deactivated by cascade from its ESAVI Case'
    };
    await Notifier.update(
        {
            isActive: false,
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        { where: { caseId, isActive: true }, transaction }
    );
}

// The classification of the case joins the same cascade, on the same terms. It is at most one
// row — UQ_classification_case is a one to one — but the update is still a mass one filtered by
// caseId: it takes no decision per row, and a case with no classification updates zero rows and
// does not fail. SPEC F09 adds this satellite to the mechanism SPEC F07 left in place
const cascadeDeactivateClassification = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const now = new Date();
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Classification deactivated by cascade from its ESAVI Case'
    };
    await Classification.update(
        {
            isActive: false,
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        { where: { caseId, isActive: true }, transaction }
    );
}

// The notification of the case joins the same cascade, on the same terms and for the same reason
// as the classification: UQ_notification_case makes it at most one row, but the update is still a
// mass one filtered by caseId — it takes no decision per row, and a case with no notification
// updates zero rows and does not fail. SPEC F10 adds this third satellite to the mechanism
const cascadeDeactivateNotification = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const now = new Date();
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Notification deactivated by cascade from its ESAVI Case'
    };
    await Notification.update(
        {
            isActive: false,
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        { where: { caseId, isActive: true }, transaction }
    );
}

// The investigation of the case joins the same cascade, on the same terms and for the same reason
// as the classification and the notification: UQ_investigation_case makes it at most one row, but
// the update is still a mass one filtered by caseId — it takes no decision per row, and a case
// with no investigation updates zero rows and does not fail. Rows already inactive are left alone
// by the where, so they keep their original deletedAt and receive no new entry. SPEC F28 adds this
// satellite to the mechanism SPEC F07 left in place. Its fourteen detail tables are out of scope:
// nothing walks down from here to them
const cascadeDeactivateInvestigation = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const now = new Date();
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Investigation deactivated by cascade from its ESAVI Case'
    };
    await Investigation.update(
        {
            isActive: false,
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        { where: { caseId, isActive: true }, transaction }
    );
}

// The severe detail of that notification joins the cascade too, and it is the only satellite
// reached in two hops. The chain case -> notification -> detail has to be walked explicitly:
// the mass Notification.update above does not go through notification.service.ts, so the
// cascade SPEC F13 installed there never fires from here. Without this, a detail under a
// deactivated case would end up invisible but unsealed, and therefore never purgable — two ways
// of reaching the same state with different results.
//
// severeNotification has no isActive column, so what moves is its deletedAt, and rows already
// sealed are left alone by the where: they keep their original date and receive no new entry.
// SPEC F13 adds this fourth satellite to the mechanism SPEC F07 left in place
const cascadeSealSevereNotifications = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const notifications = await Notification.findAll({
        where: { caseId },
        attributes: ['notificationId'],
        transaction
    });
    if( notifications.length === 0 ) {
        return;
    }

    const now = new Date();
    // The method is the code of the operation that dragged it, not ESAVI-SEVNOT-005*: the audit
    // says who did it, not which row it landed on
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Severe notification detail sealed by cascade from its ESAVI Case'
    };
    await SevereNotification.update(
        {
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        {
            where: {
                notificationId: notifications.map(notification => notification.notificationId),
                deletedAt: null
            },
            transaction
        }
    );
}

// The non severe branch of the same two-hop chain, sibling of the one above and written beside
// it rather than merged with it. SPEC F14 adds the fifth satellite reached from here, with the
// same mechanism and the same criterion for `method`.
//
// A notification holds at most one of the two branches, because notificationType is unique per
// row: this update always matches the rows the severe one did not. That is not an error and
// deserves no log
const cascadeSealNonSevereNotifications = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const notifications = await Notification.findAll({
        where: { caseId },
        attributes: ['notificationId'],
        transaction
    });
    if( notifications.length === 0 ) {
        return;
    }

    const now = new Date();
    // The method is the code of the operation that dragged it, not ESAVI-NSEVNOT-005*: the audit
    // says who did it, not which row it landed on
    const newEntry: AppDetails = {
        createdAt: now,
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CASE-005A',
        detail: 'Non severe notification detail sealed by cascade from its ESAVI Case'
    };
    await NonSevereNotification.update(
        {
            deletedAt: now,
            updatedAt: now,
            appDetails: appendedAppDetails(newEntry)
        },
        {
            where: {
                notificationId: notifications.map(notification => notification.notificationId),
                deletedAt: null
            },
            transaction
        }
    );
}

// The investigation branch of the same two-hop pattern, and the seventh sibling of this block.
// The chain case -> investigation -> source has to be walked explicitly, exactly like the two
// notification satellites above: the mass Investigation.update further up does NOT go through
// setInvestigationActivationService, so the cascade SPEC F29 installed there never fires from
// here. Without this function the source of an investigation dragged by its case would stay
// unsealed — invisible but not sealed, and therefore never purgable. It is the easiest mistake to
// make in that spec, and the only thing that detects it is its own acceptance criterion.
//
// investigationSource has no isActive column, so what moves is its deletedAt, and rows already
// sealed are left alone: they keep their original date and receive no new entry.
// SPEC F29 adds this satellite to the mechanism SPEC F07 left in place; SPEC F32 moved the drag
// itself to common/satelliteCascade.service.ts, so what stays here is the two-hop walk
const cascadeSealInvestigationSources = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const investigations = await Investigation.findAll({
        where: { caseId },
        attributes: ['investigationId'],
        transaction
    });
    if( investigations.length === 0 ) {
        return;
    }

    await cascadeSealSatellite({
        model: InvestigationSource,
        where: { investigationId: investigations.map(investigation => investigation.investigationId) },
        method: 'ESAVI-CASE-005A',
        detail: 'Investigation source sealed by cascade from its ESAVI Case',
        authUser,
        transaction
    });
}

// The second satellite of the investigation branch, and the eighth sibling of this block. It is
// necessary and not redundant, by the exact reason the seventh one documents: the mass
// Investigation.update further up does NOT go through setInvestigationActivationService, so the
// cascade SPEC F30 installed there never fires from here. Without this function the autopsy of an
// investigation dragged by its case would stay unsealed — invisible but not sealed, and therefore
// never purgable. It is the easiest mistake to make in that spec, and the only thing that detects
// it is its own acceptance criterion.
//
// investigationAutopsy has no isActive column either, so what moves is its deletedAt, and rows
// already sealed are left alone: they keep their original date and receive no new entry.
// ESAVI-CASE-005B clears nothing, coherent with F07 and F29
const cascadeSealInvestigationAutopsies = async (caseId: string, authUser: AuthUser | undefined, transaction: Transaction) => {
    const investigations = await Investigation.findAll({
        where: { caseId },
        attributes: ['investigationId'],
        transaction
    });
    if( investigations.length === 0 ) {
        return;
    }

    await cascadeSealSatellite({
        model: InvestigationAutopsy,
        where: { investigationId: investigations.map(investigation => investigation.investigationId) },
        method: 'ESAVI-CASE-005A',
        detail: 'Investigation autopsy sealed by cascade from its ESAVI Case',
        authUser,
        transaction
    });
}

// Setting ESAVI Case Active/Inactive Service
// Code: ESAVI-CASE-005A / ESAVI-CASE-005B
// 005A also deactivates every active notifier of the case, its active classification and its
// active notification; 005B reactivates none of them. The
// asymmetry is deliberate: reactivating in cascade would resurrect notifiers somebody retired
// on purpose before touching the case, and that information cannot be recovered afterwards
const setEsaviCaseActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // The where filters by the primary key only: the generic service is the one that tells
        // 'does not exist' (404) from 'already in that state' (409)
        await setEntityActiveStatusService({
            model: EsaviCase,
            where: { caseId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('esaviCase.notFound', lang),
            notFoundCode: `CASE_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`esaviCase.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `CASE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-CASE-${ op }`,
                detail: `ESAVI Case ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });

        // Only downwards, and only after the case itself went down: if the case was already
        // inactive, the generic service threw a 409 above and the cascade is never reached
        if( !isActive ) {
            await cascadeDeactivateNotifiers(id, authUser, transaction);
            await cascadeDeactivateClassification(id, authUser, transaction);
            await cascadeDeactivateNotification(id, authUser, transaction);
            await cascadeDeactivateInvestigation(id, authUser, transaction);
            await cascadeSealSevereNotifications(id, authUser, transaction);
            await cascadeSealNonSevereNotifications(id, authUser, transaction);
            await cascadeSealInvestigationSources(id, authUser, transaction);
            await cascadeSealInvestigationAutopsies(id, authUser, transaction);
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createEsaviCaseService,
    getEsaviCasesService,
    getAllEsaviCasesService,
    getEsaviCaseByIdService,
    updateEsaviCaseService,
    setEsaviCaseActivationService
}
