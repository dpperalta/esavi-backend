import { CatalogItem, CatalogType, EsaviCase, GeoLocation, Notifier } from '../models';
import { AppError, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';
import { AppDetails, AuthUser, CreateNotifierInput } from '../types';

// Code of the catalogType that groups the valid professions. Without this check any active
// catalogItem of the system — a facility type, a sex — would enter as a profession and the
// stored value would be useless
const PROFESSION_CATALOG_CODE = 'profession';

// The four encrypted columns. Normalized before encrypting: encrypting first would store the
// ciphertext of the raw text, and 'ana@correo.ec' and 'ANA@Correo.EC' would become two
// different and unrecoverable values. phoneNumber, room and details stay in clear text
const PII_FIELDS = ['firstName', 'lastName', 'email', 'address'];

const normalizeName = (value: string): string => toTitleCase(value.trim());
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

const decryptPii = (plain: Record<string, unknown>) => {
    for( const field of PII_FIELDS ) {
        if( !( field in plain ) ) continue;
        const value = plain[field];
        plain[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

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

export {
    createNotifierService
}
