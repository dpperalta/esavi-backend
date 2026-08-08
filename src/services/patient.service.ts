import { CatalogItem, CatalogType, GeoLocation, Patient } from '../models';
import { AppError, esaviCrypt, esaviDecrypt, generateHealthSystemCode, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreatePatientInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Code of the catalogType that groups the valid sex values. Unlike healthFacility, there is
// no TRG_patient_validateCatalogs trigger in esaviapp.sql: without this check any active
// catalogItem would be accepted as a sex and nobody would notice
const SEX_CATALOG_CODE = 'sex';

// The seven encrypted columns. Normalized before encrypting: encrypting first would store the
// ciphertext of the raw text, and the fixed IV that makes equality lookups possible would then
// treat '1712345678-k' and '1712345678-K' as two different patients
const PII_FIELDS = ['firstName', 'middleName', 'lastName', 'secondLastName', 'documentNumber', 'passportNumber', 'email'];

const normalizeName = (value: string): string => toTitleCase(value.trim());
const normalizeDocument = (value: string): string => value.trim().toUpperCase();
const normalizeEmail = (value: string): string => value.trim().toLowerCase();

// birthDate is a calendar date: only the YYYY-MM-DD part is stored, so a full ISO timestamp
// coming from the client cannot shift the day through the server time zone
const normalizeBirthDate = (value: string): string => value.trim().slice(0, 10);

const SEX_INCLUDE = {
    model: CatalogItem,
    as: 'sex',
    attributes: ['catalogItemId', 'code', 'name']
};

const RESIDENCE_INCLUDE = {
    model: GeoLocation,
    as: 'residence',
    attributes: ['geoLocationId', 'name', 'geoLevelTypeId', 'level']
};

// A list row carries only three of the seven encrypted columns, so the reduced shape must not
// grow the other four back as nulls: only the fields actually selected are touched
const LIST_ATTRIBUTES = ['patientId', 'firstName', 'lastName', 'documentNumber', 'birthDate', 'healthSystemCode', 'isActive'];

// The reduced shape drops the level of the residence: a list needs the name, not the hierarchy
const LIST_RESIDENCE_INCLUDE = {
    model: GeoLocation,
    as: 'residence',
    attributes: ['geoLocationId', 'name']
};

// Newest first. Alphabetical is impossible: the names are encrypted and ORDER BY "lastName"
// would sort by the ciphertext — an arbitrary but stable order that looks like it works
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// sysDetails is trigger metadata and never leaves the service. The two raw foreign keys go with
// it: the response carries the resolved sex and residence objects instead
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'sexItemId', 'residenceGeoLocationId'] };

const decryptPii = (plain: Record<string, unknown>) => {
    for( const field of PII_FIELDS ) {
        if( !( field in plain ) ) continue;
        const value = plain[field];
        plain[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

// The seven encrypted columns are returned in clear text
const toPatientResponse = (patient: Patient) => {
    const plain = patient.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.sexItemId;
    delete plain.residenceGeoLocationId;
    return decryptPii(plain);
}

// A list has no reason to dump the email and the phone of every person on the page, nor the
// audit history of each one. Whoever needs them asks for the patient through 003
const toPatientListRow = (patient: Patient) => decryptPii(patient.toJSON() as Record<string, unknown>);

// The read the write operations share to build their response
const findPatientWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { patientId: id } : { patientId: id, isActive: true };
    return await Patient.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [SEX_INCLUDE, RESIDENCE_INCLUDE]
    });
}

// sexItemId must exist, be active and belong to the 'sex' catalog. Shared by 001 and 004 so the
// three conditions cannot drift apart; the operation code travels in so the AppError keeps it
const assertSexItemIsValid = async (sexItemId: string, op: string, lang: string) => {
    const sexItem = await CatalogItem.findOne({
        where: { catalogItemId: sexItemId, isActive: true },
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: SEX_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !sexItem ) {
        throw new AppError(getMessage('patient.sexNotFound', lang), 404, `PATIENT_${ op }_SEX_NOT_FOUND`);
    }
}

const assertResidenceIsValid = async (residenceGeoLocationId: string, op: string, lang: string) => {
    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId: residenceGeoLocationId, isActive: true },
        attributes: ['geoLocationId']
    });
    if( !geoLocation ) {
        throw new AppError(getMessage('patient.geoLocationNotFound', lang), 404, `PATIENT_${ op }_GEOLOC_NOT_FOUND`);
    }
}

// Create Patient Service
// Code: ESAVI-PATIENT-001
const createPatientService = async (data: CreatePatientInput, authUser: AuthUser | undefined, lang: string) => {
    // Normalize first, encrypt second: the order is what keeps uniqueness and search working
    const firstName = esaviCrypt(normalizeName(data.firstName));
    const lastName = esaviCrypt(normalizeName(data.lastName));
    const documentNumber = esaviCrypt(normalizeDocument(data.documentNumber));
    const middleName = data.middleName ? esaviCrypt(normalizeName(data.middleName)) : null;
    const secondLastName = data.secondLastName ? esaviCrypt(normalizeName(data.secondLastName)) : null;
    const passportNumber = data.passportNumber ? esaviCrypt(normalizeDocument(data.passportNumber)) : null;
    const email = data.email ? esaviCrypt(normalizeEmail(data.email)) : null;

    // Uniqueness does not filter by isActive: that is what UQ_patient_documentNumber guarantees,
    // and filtering would let through values Postgres rejects with 23505 — a 500 instead of a 409
    const existingDocument = await Patient.findOne({
        where: { documentNumber },
        attributes: ['patientId']
    });
    if( existingDocument ) {
        throw new AppError(getMessage('patient.documentExists', lang), 409, 'PATIENT_001_DOCUMENT_EXISTS');
    }

    if( data.sexItemId ) {
        await assertSexItemIsValid(data.sexItemId, '001', lang);
    }
    if( data.residenceGeoLocationId ) {
        await assertResidenceIsValid(data.residenceGeoLocationId, '001', lang);
    }

    // Generated here and never received: whatever the client sent under this name is ignored
    // without an error. Uniqueness is not checked on purpose — see SPEC F05 §6
    const healthSystemCode = generateHealthSystemCode();

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-PATIENT-001',
        detail: 'Patient created by service'
    };
    const newPatient = await Patient.create({
        firstName,
        middleName,
        lastName,
        secondLastName,
        birthDate: data.birthDate ? normalizeBirthDate(data.birthDate) : null,
        documentNumber,
        passportNumber,
        email,
        phoneNumber: data.phoneNumber ? data.phoneNumber.trim() : null,
        healthSystemCode,
        sexItemId: data.sexItemId ?? null,
        residenceGeoLocationId: data.residenceGeoLocationId ?? null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved sex and residence, not just their ids
    const createdPatient = await findPatientWithRelations(newPatient.patientId, true);
    return createdPatient ? toPatientResponse(createdPatient) : null;
}

// Get Active Patients Service
// Code: ESAVI-PATIENT-002A
const getPatientsService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const { count, rows } = await Patient.findAndCountAll({
        where: { isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toPatientListRow) };
}

// Get All Patients Service - For Admin
// Code: ESAVI-PATIENT-002B
const getAllPatientsService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const { count, rows } = await Patient.findAndCountAll({
        attributes: LIST_ATTRIBUTES,
        include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toPatientListRow) };
}

// Get Patient By ID Service
// Code: ESAVI-PATIENT-003
const getPatientByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const patient = await findPatientWithRelations(id, canViewInactive);
    if( !patient ) {
        throw new AppError(getMessage('patient.notFound', lang), 404, 'PATIENT_003_NOT_FOUND');
    }
    return toPatientResponse(patient);
}

export {
    createPatientService,
    getPatientsService,
    getAllPatientsService,
    getPatientByIdService
}
