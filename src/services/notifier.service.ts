import { WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, GeoLocation, Notifier } from '../models';
import { AppError, buildDifferentialUpdate, esaviCrypt, esaviDecrypt, getMessage, normalizeName } from '../helpers';
import { AppDetails, AuthUser, CreateNotifierInput, NotifierListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { purgeEntityService } from './common/entityPurge.service';

// Code of the catalogType that groups the valid professions. Without this check any active
// catalogItem of the system — a facility type, a sex — would enter as a profession and the
// stored value would be useless
const PROFESSION_CATALOG_CODE = 'profession';

// The four encrypted columns. Normalized before encrypting: encrypting first would store the
// ciphertext of the raw text, and 'ana@correo.ec' and 'ANA@Correo.EC' would become two
// different and unrecoverable values. phoneNumber, room and details stay in clear text
const PII_FIELDS = ['firstName', 'lastName', 'email', 'address'];

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    attributes: ['caseId', 'caseCode', 'reportDate']
};

const PROFESSION_INCLUDE = {
    model: CatalogItem,
    as: 'profession',
    attributes: ['catalogItemId', 'code', 'name']
};

const GEOLOCATION_INCLUDE = {
    model: GeoLocation,
    as: 'geoLocation',
    attributes: ['geoLocationId', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The three raw foreign keys go
// with it: the response carries the resolved case, profession and geoLocation objects instead
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'caseId', 'professionItemId', 'geoLocationId'] };

// The reduced shape drops only details and appDetails: details is free text with no length
// limit and dumping it on every row of a page makes the response size unpredictable. The
// contact fields do travel, because locating the notifier is what the list is for
const LIST_ATTRIBUTES = ['notifierId', 'firstName', 'lastName', 'email', 'phoneNumber', 'room', 'address', 'isActive'];

// Newest first. Alphabetical is impossible: the names are encrypted and ORDER BY "lastName"
// would sort by the ciphertext — an arbitrary but stable order that looks like it works
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

const decryptPii = (plain: Record<string, unknown>) => {
    for( const field of PII_FIELDS ) {
        if( !( field in plain ) ) continue;
        const value = plain[field];
        plain[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

// A list row carries the same four encrypted columns as the full shape, so nothing is added
// back as null here: decryptPii only touches the fields actually selected
const toNotifierListRow = (notifier: Notifier) => decryptPii(notifier.toJSON() as Record<string, unknown>);

// The four encrypted columns are returned in clear text
const toNotifierResponse = (notifier: Notifier) => {
    const plain = notifier.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.caseId;
    delete plain.professionItemId;
    delete plain.geoLocationId;
    return decryptPii(plain);
}

// The read the write operations share to build their response
const findNotifierWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { notifierId: id } : { notifierId: id, isActive: true };
    return await Notifier.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [CASE_INCLUDE, PROFESSION_INCLUDE, GEOLOCATION_INCLUDE]
    });
}

// The case must exist and be active: FK_notifier_case declares ON DELETE CASCADE, but
// TRG_esaviCase_preventPhysicalDelete forbids every physical delete of esaviCase, so that
// cascade never fires and nothing in the DDL stops a notifier from pointing at a retired case.
// The operation code travels in so the AppError keeps it
const assertCaseIsValid = async (caseId: string, op: string, lang: string) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('notifier.caseNotFound', lang), 404, `NOTIFIER_${ op }_CASE_NOT_FOUND`);
    }
}

// professionItemId must exist, be active and belong to the 'profession' catalog. Shared by 001
// and 004 so the three conditions cannot drift apart
const assertProfessionIsValid = async (professionItemId: string, op: string, lang: string) => {
    const professionItem = await CatalogItem.findOne({
        where: { catalogItemId: professionItemId, isActive: true },
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: PROFESSION_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !professionItem ) {
        throw new AppError(getMessage('notifier.professionNotFound', lang), 404, `NOTIFIER_${ op }_PROFESSION_NOT_FOUND`);
    }
}

const assertGeoLocationIsValid = async (geoLocationId: string, op: string, lang: string) => {
    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId, isActive: true },
        attributes: ['geoLocationId']
    });
    if( !geoLocation ) {
        throw new AppError(getMessage('notifier.geoLocationNotFound', lang), 404, `NOTIFIER_${ op }_GEOLOCATION_NOT_FOUND`);
    }
}

// Create Notifier Service
// Code: ESAVI-NOTIFIER-001
// No uniqueness check of any kind: the DDL declares no UNIQUE on this table, and the same
// person can legitimately notify several cases. Inside one case a duplicate is a capture
// mistake, not an integrity violation
const createNotifierService = async (data: CreateNotifierInput, authUser: AuthUser | undefined, lang: string) => {
    await assertCaseIsValid(data.caseId, '001', lang);
    if( data.professionItemId ) {
        await assertProfessionIsValid(data.professionItemId, '001', lang);
    }
    if( data.geoLocationId ) {
        await assertGeoLocationIsValid(data.geoLocationId, '001', lang);
    }

    // Normalize first, encrypt second: the order is the whole point
    const firstName = esaviCrypt(normalizeName(data.firstName));
    const lastName = esaviCrypt(normalizeName(data.lastName));
    const address = data.address ? esaviCrypt(normalizeName(data.address)) : null;
    const email = data.email ? esaviCrypt(normalizeEmail(data.email)) : null;

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFIER-001',
        detail: 'Notifier created by service'
    };
    const newNotifier = await Notifier.create({
        caseId: data.caseId,
        professionItemId: data.professionItemId ?? null,
        geoLocationId: data.geoLocationId ?? null,
        firstName,
        lastName,
        room: data.room ? data.room.trim() : null,
        address,
        phoneNumber: data.phoneNumber ? data.phoneNumber.trim() : null,
        email,
        details: data.details ? data.details.trim() : null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved case, profession and geoLocation, not their ids
    const createdNotifier = await findNotifierWithRelations(newNotifier.notifierId, true);
    return createdNotifier ? toNotifierResponse(createdNotifier) : null;
}

// The three filters are accumulated with AND, and each one is optional. A filter pointing at a
// row that does not exist yields an empty page, never a 404: searching for something absent is
// an empty search, not a missing resource. There is no filter over the encrypted columns:
// only exact equality would work on them, and this spec exposes no search endpoint
const buildListWhere = (filters: NotifierListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;
    if( filters.professionItemId ) where.professionItemId = filters.professionItemId;
    if( filters.geoLocationId ) where.geoLocationId = filters.geoLocationId;

    return where as WhereOptions;
}

// Get Active Notifiers Service
// Code: ESAVI-NOTIFIER-002A
// The where filters by the isActive of the notifier, not by the one of its case: with the
// cascade of ESAVI-CASE-005A the notifiers of a retired case are already inactive, so the
// result is the same without conditioning the include with a required: true
const getNotifiersService = async (
    filters: NotifierListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await Notifier.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, PROFESSION_INCLUDE, GEOLOCATION_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toNotifierListRow) };
}

// Get All Notifiers Service - For Admin
// Code: ESAVI-NOTIFIER-002B
const getAllNotifiersService = async (
    filters: NotifierListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const { count, rows } = await Notifier.findAndCountAll({
        where: buildListWhere(filters),
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, PROFESSION_INCLUDE, GEOLOCATION_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toNotifierListRow) };
}

// Get Notifier By ID Service
// Code: ESAVI-NOTIFIER-003
const getNotifierByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const notifier = await findNotifierWithRelations(id, canViewInactive);
    if( !notifier ) {
        throw new AppError(getMessage('notifier.notFound', lang), 404, 'NOTIFIER_003_NOT_FOUND');
    }
    return toNotifierResponse(notifier);
}

// Update Notifier Service
// Code: ESAVI-NOTIFIER-004
// caseId is ignored whether or not it arrives in the body: a notifier is not moved between
// cases, it is deactivated and created again on the right one. Moving it would leave two cases
// with an incoherent audit trail — the origin records a departure its history does not explain
const updateNotifierService = async (id: string, data: Partial<CreateNotifierInput>, authUser: AuthUser | undefined, lang: string) => {
    const notifier = await Notifier.findByPk(id);
    if( !notifier ) {
        throw new AppError(getMessage('notifier.notFound', lang), 404, 'NOTIFIER_004_NOT_FOUND');
    }

    if( data.professionItemId ) {
        await assertProfessionIsValid(data.professionItemId, '004', lang);
    }
    if( data.geoLocationId ) {
        await assertGeoLocationIsValid(data.geoLocationId, '004', lang);
    }

    // Differential update: only what really changed reaches the UPDATE. Until now the object was
    // built out of which keys arrived, never comparing them with what was stored, so resending
    // whole the record just read with a GET — the normal use of a form — re-encrypted and
    // rewrote the four PII columns with their own value. `stored` is the whole row, which is the
    // precondition of the helper, with those four decrypted by the same decryptPii the responses
    // use: the comparison is over plain text and never ciphertext against ciphertext, which only
    // works because esaviCrypt has a fixed IV. Tying the update to that would make moving to a
    // random IV break the comparison in silence — everything would count as a change — and no
    // test would tell it apart from a legitimate one. Normalize first, encrypt second, same as
    // in 001, but the encryption now happens after the diff and only over what it returned
    const stored = decryptPii(notifier.get({ plain: true }) as Record<string, unknown>);
    const changes = buildDifferentialUpdate(stored, {
        professionItemId: data.professionItemId !== undefined ? ( data.professionItemId ?? null ) : undefined,
        geoLocationId: data.geoLocationId !== undefined ? ( data.geoLocationId ?? null ) : undefined,
        firstName: data.firstName ? normalizeName(data.firstName) : undefined,
        lastName: data.lastName ? normalizeName(data.lastName) : undefined,
        address: data.address !== undefined ? ( data.address ? normalizeName(data.address) : null ) : undefined,
        email: data.email !== undefined ? ( data.email ? normalizeEmail(data.email) : null ) : undefined,
        room: data.room !== undefined ? ( data.room ? data.room.trim() : null ) : undefined,
        phoneNumber: data.phoneNumber !== undefined ? ( data.phoneNumber ? data.phoneNumber.trim() : null ) : undefined,
        details: data.details !== undefined ? ( data.details ? data.details.trim() : null ) : undefined
    });

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. The record is returned as it
    // stands, which is the state the client asked for
    if( Object.keys(changes).length === 0 ) {
        const unchanged = await findNotifierWithRelations(id, true);
        return unchanged ? toNotifierResponse(unchanged) : null;
    }

    const objectToUpdate: Record<string, unknown> = { ...changes };
    for( const field of PII_FIELDS ) {
        if( objectToUpdate[field] ) {
            objectToUpdate[field] = esaviCrypt(objectToUpdate[field] as string);
        }
    }

    // Written by hand so the service does not depend on a trigger for a column it owns. The
    // named TRG_<table>_setUpdatedAt really is dropped and never created by the generic loop of
    // esaviapp.sql, but setSysDetails does the job anyway: it runs BEFORE UPDATE on every table
    // carrying sysDetails and overwrites this value with current_timestamp
    objectToUpdate.updatedAt = new Date();

    const currentAppDetails = Array.isArray(notifier.appDetails) ? notifier.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFIER-004',
        detail: 'Notifier updated by service'
    };
    await notifier.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updatedNotifier = await findNotifierWithRelations(id, true);
    return updatedNotifier ? toNotifierResponse(updatedNotifier) : null;
}

// Setting Notifier Active/Inactive Service
// Code: ESAVI-NOTIFIER-005A / ESAVI-NOTIFIER-005B
// Reactivating does NOT require the case to be active. It is deliberate: the cascade only goes
// down, and whoever reactivates is SUPERADMIN, the only role that sees inactive cases at all.
// Blocking it would force reactivating the case first, reverting a larger administrative
// decision to fix a smaller one
const setNotifierActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // The where filters by the primary key only: the generic service is the one that tells
        // 'does not exist' (404) from 'already in that state' (409)
        await setEntityActiveStatusService({
            model: Notifier,
            where: { notifierId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('notifier.notFound', lang),
            notFoundCode: `NOTIFIER_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`notifier.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `NOTIFIER_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-NOTIFIER-${ op }`,
                detail: `Notifier ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Purging Notifier Service - For SuperAdmin
// Code: ESAVI-NOTIFIER-005C
// notifier is outside the preventPhysicalDelete loop of esaviapp.sql:1354-1360, so the row can
// really be destroyed. Purging a notifier does not touch its case: the foreign key runs from
// the notifier to the case and not the other way round, and no table references notifierId
const purgeNotifierService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        await purgeEntityService({
            model: Notifier,
            where: { notifierId: id },
            transaction,
            operationCode: 'ESAVI-NOTIFIER-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('notifier.notFound', lang),
            notFoundCode: 'NOTIFIER_005C_NOT_FOUND',
            stillActiveMessage: getMessage('notifier.stillActive', lang, { id }),
            stillActiveCode: 'NOTIFIER_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNotifierService,
    getNotifiersService,
    getAllNotifiersService,
    getNotifierByIdService,
    updateNotifierService,
    setNotifierActivationService,
    purgeNotifierService
}
