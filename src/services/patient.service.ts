import { Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, GeoLocation, Patient } from '../models';
import { AppError, buildDifferentialUpdate, esaviCrypt, esaviDecrypt, generateHealthSystemCode, getMessage, normalizeName, toNameTokens } from '../helpers';
import { AppDetails, AuthUser, CreatePatientInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { recalculateClassificationAgesService } from './common/ageRecalculation.service';

// Code of the catalogType that groups the valid sex values. Unlike healthFacility, there is
// no TRG_patient_validateCatalogs trigger in esaviapp.sql: without this check any active
// catalogItem would be accepted as a sex and nobody would notice
const SEX_CATALOG_CODE = 'sex';

// The five single-value encrypted columns. Normalized before encrypting: encrypting first would
// store the ciphertext of the raw text, and the fixed IV that makes equality lookups possible
// would then treat '1712345678-k' and '1712345678-K' as two different patients. nameTokens is
// encrypted too, but element by element — it is handled on its own wherever this list is used
const PII_FIELDS = ['names', 'lastNames', 'documentNumber', 'passportNumber', 'email'];

const normalizeDocument = (value: string): string => value.trim().toUpperCase();
const normalizeEmail = (value: string): string => value.trim().toLowerCase();

// birthDate is a calendar date: only the YYYY-MM-DD part is stored, so a full ISO timestamp
// coming from the client cannot shift the day through the server time zone
const normalizeBirthDate = (value: string): string => value.trim().slice(0, 10);

// `value` travels alongside `code`: sex is one of the catalogs SPEC F46 found seeded with a numeric
// code, so it is the value that names the item for a reader — even though sex is not among the five
// rows the spec locks, since only production code resolves an item by its frozen value
const SEX_INCLUDE = {
    model: CatalogItem,
    as: 'sex',
    attributes: ['catalogItemId', 'code', 'name', 'value']
};

const RESIDENCE_INCLUDE = {
    model: GeoLocation,
    as: 'residence',
    attributes: ['geoLocationId', 'name', 'geoLevelTypeId', 'level']
};

// A list row carries only three of the five encrypted columns, so the reduced shape must not
// grow the other two back as nulls: only the fields actually selected are touched
const LIST_ATTRIBUTES = ['patientId', 'names', 'lastNames', 'documentNumber', 'birthDate', 'healthSystemCode', 'isActive'];

// The reduced shape drops the level of the residence: a list needs the name, not the hierarchy
const LIST_RESIDENCE_INCLUDE = {
    model: GeoLocation,
    as: 'residence',
    attributes: ['geoLocationId', 'name']
};

// Newest first. Alphabetical is impossible: the names are encrypted and ORDER BY "lastNames"
// would sort by the ciphertext — an arbitrary but stable order that looks like it works
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// sysDetails is trigger metadata and never leaves the service. The two raw foreign keys go with
// it: the response carries the resolved sex and residence objects instead. nameTokens is search
// machinery: exposing it would hand out the encrypted search form of every name, and with it the
// frequency-analysis surface SPEC F47 §8 accepts only for direct database access, not the API
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'sexItemId', 'residenceGeoLocationId', 'nameTokens'] };

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
// three conditions cannot drift apart; the operation code travels in so the AppError keeps it.
// The transaction is optional because 001 writes without one and 004 opens its own
const assertSexItemIsValid = async (sexItemId: string, op: string, lang: string, transaction?: Transaction) => {
    const sexItem = await CatalogItem.findOne({
        where: { catalogItemId: sexItemId, isActive: true },
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: SEX_CATALOG_CODE },
            attributes: []
        }],
        transaction
    });
    if( !sexItem ) {
        throw new AppError(getMessage('patient.sexNotFound', lang), 404, `PATIENT_${ op }_SEX_NOT_FOUND`);
    }
}

const assertResidenceIsValid = async (residenceGeoLocationId: string, op: string, lang: string, transaction?: Transaction) => {
    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId: residenceGeoLocationId, isActive: true },
        attributes: ['geoLocationId'],
        transaction
    });
    if( !geoLocation ) {
        throw new AppError(getMessage('patient.geoLocationNotFound', lang), 404, `PATIENT_${ op }_GEOLOC_NOT_FOUND`);
    }
}

// Create Patient Service
// Code: ESAVI-PATIENT-001
const createPatientService = async (data: CreatePatientInput, authUser: AuthUser | undefined, lang: string) => {
    // Normalize first, encrypt second: the order is what keeps uniqueness and search working
    const names = esaviCrypt(normalizeName(data.names));
    const lastNames = esaviCrypt(normalizeName(data.lastNames));
    const documentNumber = esaviCrypt(normalizeDocument(data.documentNumber));
    const passportNumber = data.passportNumber ? esaviCrypt(normalizeDocument(data.passportNumber)) : null;
    const email = data.email ? esaviCrypt(normalizeEmail(data.email)) : null;

    // Tokenized on the raw values, before encryption — toSearchForm does its own normalization,
    // so title-casing here would only be redundant work. Each token is encrypted on its own so
    // the GIN index compares ciphertext-to-ciphertext, never plaintext
    const nameTokens = toNameTokens(data.names, data.lastNames).map((token) => esaviCrypt(token));

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
        names,
        lastNames,
        nameTokens,
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

// Update Patient Service
// Code: ESAVI-PATIENT-004
// healthSystemCode is ignored whether or not it arrives in the body: an identifier that changes
// stops identifying, and any document already printed with the old value would be orphaned.
// The whole body runs inside a transaction — as setPatientActivationService already does — so a
// failure after the patient row is written leaves nothing half applied
const updatePatientService = async (id: string, data: Partial<CreatePatientInput>, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        const patient = await Patient.findByPk(id, { transaction });
        if( !patient ) {
            throw new AppError(getMessage('patient.notFound', lang), 404, 'PATIENT_004_NOT_FOUND');
        }

        // Same criterion as 001: uniqueness does not filter by isActive and excludes this record
        const targetDocumentNumber = data.documentNumber ? esaviCrypt(normalizeDocument(data.documentNumber)) : undefined;
        if( targetDocumentNumber && targetDocumentNumber !== patient.documentNumber ) {
            const existingDocument = await Patient.findOne({
                where: {
                    documentNumber: targetDocumentNumber,
                    patientId: { [Op.ne]: id }
                },
                attributes: ['patientId'],
                transaction
            });
            if( existingDocument ) {
                throw new AppError(getMessage('patient.documentExists', lang), 409, 'PATIENT_004_DOCUMENT_EXISTS');
            }
        }

        if( data.sexItemId ) {
            await assertSexItemIsValid(data.sexItemId, '004', lang, transaction);
        }
        if( data.residenceGeoLocationId ) {
            await assertResidenceIsValid(data.residenceGeoLocationId, '004', lang, transaction);
        }

        // Differential update: only what really changed reaches the UPDATE. Until now the object was
        // built out of which keys arrived, never comparing them with what was stored, so resending
        // whole the record just read with a GET — the normal use of a form — re-encrypted and
        // rewrote the seven PII columns with their own value. `stored` is the whole row, which is
        // the precondition of the helper, with the encrypted columns decrypted: the comparison is
        // over plain text and never ciphertext against ciphertext, which only works because
        // esaviCrypt has a fixed IV. Tying the update to that would make moving to a random IV break
        // the comparison in silence — everything would count as a change — and no test would tell it
        // apart from a legitimate one. esaviCrypt is applied afterwards, over what the diff returned
        const stored = patient.get({ plain: true }) as Record<string, unknown>;
        for( const field of PII_FIELDS ) {
            const value = stored[field];
            if( value ) {
                stored[field] = esaviDecrypt(value as string);
            }
        }
        // nameTokens is compared as a list of plain-text tokens, never ciphertext against
        // ciphertext: each token was encrypted on its own, so the stored array is decrypted
        // element by element before it reaches buildDifferentialUpdate
        stored.nameTokens = Array.isArray(stored.nameTokens)
            ? (stored.nameTokens as string[]).map((token) => esaviDecrypt(token))
            : [];

        // The names and last names that are about to be stored — the new ones if they came in the
        // body, the stored ones otherwise. This is what nameTokens is recomputed from, never from
        // the raw candidate alone, or a PUT that only touches phoneNumber would blank the tokens
        const resultingNames = data.names ? data.names : (stored.names as string);
        const resultingLastNames = data.lastNames ? data.lastNames : (stored.lastNames as string);

        const changes = buildDifferentialUpdate(stored, {
            names: data.names ? normalizeName(data.names) : undefined,
            lastNames: data.lastNames ? normalizeName(data.lastNames) : undefined,
            // Derived, not conditioned by presence: it enters the diff on every update, and it is
            // buildDifferentialUpdate — not this line — that decides whether it actually changed
            nameTokens: toNameTokens(resultingNames, resultingLastNames),
            documentNumber: data.documentNumber ? normalizeDocument(data.documentNumber) : undefined,
            passportNumber: data.passportNumber !== undefined ? ( data.passportNumber ? normalizeDocument(data.passportNumber) : null ) : undefined,
            email: data.email !== undefined ? ( data.email ? normalizeEmail(data.email) : null ) : undefined,
            birthDate: data.birthDate !== undefined ? ( data.birthDate ? normalizeBirthDate(data.birthDate) : null ) : undefined,
            phoneNumber: data.phoneNumber !== undefined ? ( data.phoneNumber ? data.phoneNumber.trim() : null ) : undefined,
            sexItemId: data.sexItemId !== undefined ? ( data.sexItemId || null ) : undefined,
            residenceGeoLocationId: data.residenceGeoLocationId !== undefined ? ( data.residenceGeoLocationId || null ) : undefined
        });

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. The record is returned as it
        // stands, which is the state the client asked for
        if( Object.keys(changes).length > 0 ) {
            const objectToUpdate: Record<string, unknown> = { ...changes };
            for( const field of PII_FIELDS ) {
                if( objectToUpdate[field] ) {
                    objectToUpdate[field] = esaviCrypt(objectToUpdate[field] as string);
                }
            }
            if( 'nameTokens' in objectToUpdate ) {
                objectToUpdate.nameTokens = (objectToUpdate.nameTokens as string[]).map((token) => esaviCrypt(token));
            }

            const currentAppDetails = Array.isArray(patient.appDetails) ? patient.appDetails : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-PATIENT-004',
                detail: 'Patient updated by service'
            };
            await patient.update({
                ...objectToUpdate,
                updatedAt: new Date(),
                appDetails: [
                    ...currentAppDetails,
                    newEntry
                ]
            }, { transaction });

            // classification.age is derived from this birthDate, so correcting it leaves the stored
            // age of every classification of this patient contradicting its own origin unless they
            // are recalculated here. The differential is the trigger: the key only survives it when
            // the resulting value really differs from the stored one, so a PUT that just corrects
            // the phone number does not walk the patient's cases at all.
            //
            // It runs AFTER the write and inside the same transaction, so the recalculation reads
            // the new birthDate without it having to be passed in. If it throws — a 409 for a birth
            // after the event of one of the cases, a 404 for a missing ageUnit item — the rollback
            // undoes this write and every classification already recalculated in this loop, so the
            // patient keeps its previous birthDate and no classification is left half updated
            if( 'birthDate' in objectToUpdate ) {
                await recalculateClassificationAgesService({ patientId: id }, 'ESAVI-PATIENT-004', authUser, lang, transaction);
            }
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Read outside the transaction, once it is committed: the response is the same whether or not
    // anything changed, so both paths converge here
    const updatedPatient = await findPatientWithRelations(id, true);
    return updatedPatient ? toPatientResponse(updatedPatient) : null;
}

// Search Patients By Identifier Service
// Code: ESAVI-PATIENT-006
// One query over the three identifiers a client can type into a single box. findAndCountAll and
// not findOne: passportNumber has no UNIQUE in the DDL, so findOne would return an arbitrary row
// and hide the rest. An empty result is a result — it never raises a 404
const searchPatientsByIdentifierService = async (
    identifier: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const normalized = normalizeDocument(identifier);
    if( !normalized ) {
        throw new AppError(getMessage('patient.identifierRequired', lang), 400, 'PATIENT_006_IDENTIFIER_REQUIRED');
    }
    // healthSystemCode is the only one of the three stored in clear text
    const encrypted = esaviCrypt(normalized);
    const { count, rows } = await Patient.findAndCountAll({
        where: {
            ...( canViewInactive ? {} : { isActive: true } ),
            [Op.or]: [
                { documentNumber: encrypted },
                { passportNumber: encrypted },
                { healthSystemCode: normalized }
            ]
        },
        attributes: LIST_ATTRIBUTES,
        include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toPatientListRow) };
}

// Search Patients By Name Service
// Code: ESAVI-PATIENT-007
// nameTokens holds no provenance of which token came from names or lastNames, so the query can
// only ask "these tokens, somewhere in the name" — never distinguish a first name from a last
// name (SPEC F45 §4). Op.contains: [] is true for every row, so a name that tokenizes to zero
// elements is rejected here even though the validator already rejects an empty string: the guard
// covers what the validator structurally cannot see — a string that survives notEmpty but still
// tokenizes to nothing, such as one made only of combining diacritical marks (SPEC F45 §3.2)
const searchPatientsByNameService = async (
    name: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const tokens = toNameTokens(name);
    if( tokens.length === 0 ) {
        throw new AppError(getMessage('patient.nameRequired', lang), 400, 'PATIENT_007_NAME_REQUIRED');
    }
    const encryptedTokens = tokens.map((token) => esaviCrypt(token));

    const tokensWhere = { nameTokens: { [Op.contains]: encryptedTokens } };
    const { count, rows } = await Patient.findAndCountAll({
        where: {
            ...tokensWhere,
            ...( canViewInactive ? {} : { isActive: true } )
        },
        attributes: LIST_ATTRIBUTES,
        include: [SEX_INCLUDE, LIST_RESIDENCE_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });

    // Always computed, regardless of role: a deactivated patient who matches must surface as a
    // signal, or a USER who cannot see inactive rows silently duplicates them (SPEC F45 §3.3)
    const inactiveCount = await Patient.count({
        where: { ...tokensWhere, isActive: false }
    });

    return { count, inactiveCount, rows: rows.map(toPatientListRow) };
}

// Setting Patient Active/Inactive Service
// Code: ESAVI-PATIENT-005A / ESAVI-PATIENT-005B
// No incoming reference is checked, not esaviCase nor any other: this is a logical delete, so
// ON DELETE RESTRICT never fires, and esaviCase has no model yet
const setPatientActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // The where filters by the primary key only: the generic service is the one that tells
        // 'does not exist' (404) from 'already in that state' (409)
        await setEntityActiveStatusService({
            model: Patient,
            where: { patientId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('patient.notFound', lang),
            notFoundCode: `PATIENT_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`patient.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `PATIENT_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-PATIENT-${ op }`,
                detail: `Patient ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createPatientService,
    getPatientsService,
    getAllPatientsService,
    getPatientByIdService,
    updatePatientService,
    setPatientActivationService,
    searchPatientsByIdentifierService,
    searchPatientsByNameService
}
