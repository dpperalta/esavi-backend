import { CatalogItem, CatalogType, EsaviCase, GeoLocation, HealthFacility, Notification, NonSevereNotification } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNonSevereNotificationInput } from '../types';
import { NotificationType } from '../constants/notification.constants';

// Only a NON_SEVERE header admits a non severe detail. A SEVERE one never can, which is why the
// mismatch is a 409 against the state of another row and not a 400 about a malformed body
const NON_SEVERE_TYPE: NotificationType = 'NON_SEVERE';

// Code of the catalogType that groups the vaccination sites. Without this check any active
// catalogItem of the system would enter as a vaccination site.
// catalogType codes are stored in camelCase — catalogType.service.ts:12
const VACCINATION_SITE_CATALOG_CODE = 'vaccinationSite';

// The header travels in every response: it is what governs the visibility of the detail, and
// hiding it would leave the client unable to explain why a record it read yesterday now answers
// 404. Its own sysDetails stays out, like the one of the detail
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'notificationType', 'esaviDescription', 'isActive'],
    include: [{
        model: EsaviCase,
        as: 'case',
        attributes: ['caseId', 'caseCode', 'eventDate']
    }]
};

// The three vaccination place includes, and none of them filters by isActive on purpose. A health
// facility deactivated after the registration is still returned: the row is historical, it says
// where the vaccination happened. Filtering them would return null where there is stored data,
// and a client resending that GET would write a dissociation nobody asked for
const VACCINATION_HEALTH_FACILITY_INCLUDE = {
    model: HealthFacility,
    as: 'vaccinationHealthFacility',
    attributes: ['healthFacilityId', 'name', 'localCode']
};

const VACCINATION_SITE_INCLUDE = {
    model: CatalogItem,
    as: 'vaccinationSite',
    attributes: ['catalogItemId', 'code', 'name']
};

const VACCINATION_GEO_LOCATION_INCLUDE = {
    model: GeoLocation,
    as: 'vaccinationGeoLocation',
    attributes: ['geoLocationId', 'name', 'level']
};

// sysDetails is trigger metadata and never leaves the service. The three raw foreign keys go with
// it: the response carries the resolved objects instead, and returning both would invite two
// clients to read different places and one of them to fall behind.
// notificationId does travel, unlike those three: here it is the primary key of the row
const DETAIL_EXCLUDE = {
    exclude: ['sysDetails', 'vaccinationHealthFacilityId', 'vaccinationSiteItemId', 'vaccinationGeoLocationId']
};

// The six tri-state fields are returned exactly as stored, null included: they are never
// normalized to NO_ANSWER nor to false when building the response. A null means the form did not
// collect the answer, and NO_ANSWER means the notifier deliberately gave none.
// There is no isActive to return — the table does not have that column. deletedAt is the only
// status mark the row carries, and notification.isActive is the real source
const toNonSevereNotificationResponse = (nonSevereNotification: NonSevereNotification) => {
    const plain = nonSevereNotification.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.vaccinationHealthFacilityId;
    delete plain.vaccinationSiteItemId;
    delete plain.vaccinationGeoLocationId;

    // A foreign key that was never informed comes back as an explicit null, never as a missing
    // key: a client iterating the three must not have to tell "empty" from "absent"
    plain.vaccinationHealthFacility = plain.vaccinationHealthFacility ?? null;
    plain.vaccinationSite = plain.vaccinationSite ?? null;
    plain.vaccinationGeoLocation = plain.vaccinationGeoLocation ?? null;

    const notification = plain.notification as Record<string, unknown> | null | undefined;
    if( notification ) delete notification.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The header include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a detail hanging from a retired header simply does not come back
const findNonSevereNotificationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NonSevereNotification.findOne({
        where: { notificationId: id },
        attributes: DETAIL_EXCLUDE,
        include: [
            {
                ...NOTIFICATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            VACCINATION_HEALTH_FACILITY_INCLUDE,
            VACCINATION_SITE_INCLUDE,
            VACCINATION_GEO_LOCATION_INCLUDE
        ]
    });
}

// The header must exist and be active: a retired notification does not take a new detail. The
// operation code travels in so the AppError keeps it
const assertNotificationIsValid = async (notificationId: string, op: string, lang: string) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId', 'notificationType']
    });
    if( !notification ) {
        throw new AppError(
            getMessage('nonSevereNotification.notificationNotFound', lang),
            404,
            `NSEVNOT_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }

    if( notification.notificationType !== NON_SEVERE_TYPE ) {
        throw new AppError(
            getMessage('nonSevereNotification.notificationNotNonSevere', lang, { notificationId }),
            409,
            `NSEVNOT_${ op }_NOTIFICATION_NOT_NON_SEVERE`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The check is a findByPk of its own and does not rely on
// the collision — a 23505 would reach the client as a 500 and its Postgres message says nothing
// useful. The message carries the notificationId because otherwise the client sees a 409 about a
// row it did not name
const assertDetailDoesNotExist = async (notificationId: string, op: string, lang: string) => {
    const existing = await NonSevereNotification.findByPk(notificationId, { attributes: ['notificationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('nonSevereNotification.alreadyExists', lang, { notificationId }),
            409,
            `NSEVNOT_${ op }_ALREADY_EXISTS`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is
// no text at all. There is neither `code` nor `name` here, so neither toConstantCase nor
// toTitleCase apply
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The vaccination health facility must exist and be active. This is the resolution, not the
// decision of when to run it: 001 resolves every key that arrives with a value, and 004 resolves
// only the ones whose value changes
const assertVaccinationHealthFacilityIsValid = async (healthFacilityId: string, op: string, lang: string) => {
    const healthFacility = await HealthFacility.findOne({
        where: { healthFacilityId, isActive: true },
        attributes: ['healthFacilityId']
    });
    if( !healthFacility ) {
        throw new AppError(
            getMessage('nonSevereNotification.healthFacilityNotFound', lang),
            404,
            `NSEVNOT_${ op }_HEALTH_FACILITY_NOT_FOUND`
        );
    }
}

// The item must exist, be active and belong to the vaccination site catalog: any other
// catalogItem would be a valid UUID pointing at a meaningless site. An unseeded catalog makes
// every vaccinationSiteItemId fall here, which is the deployment precondition the spec declares
const assertVaccinationSiteIsValid = async (vaccinationSiteItemId: string, op: string, lang: string) => {
    const vaccinationSite = await CatalogItem.findOne({
        where: { catalogItemId: vaccinationSiteItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: VACCINATION_SITE_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !vaccinationSite ) {
        throw new AppError(
            getMessage('nonSevereNotification.vaccinationSiteNotFound', lang),
            404,
            `NSEVNOT_${ op }_VACCINATION_SITE_NOT_FOUND`
        );
    }
}

// The location must exist, be active and sit at the deepest seeded level. The maximum is computed
// here and never cached: seeding a new level must change the behaviour without restarting the
// process. It is not anchored to a geoLevelType.code because those codes change from one country
// to another — parish, parroquia, ward — and anchoring the filter to a literal would condemn the
// deployment to the first country that was modelled. level is numeric and derived by the
// application, so it does not depend on local naming.
// The 404 does not tell "does not exist", "is inactive" and "is not of the admitted level" apart:
// three causes, one message, like the outcomeNotFound of F10
const assertVaccinationGeoLocationIsValid = async (geoLocationId: string, op: string, lang: string) => {
    const deepestLevel = await GeoLocation.max('level', { where: { isActive: true } });

    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId, isActive: true, level: deepestLevel as number },
        attributes: ['geoLocationId']
    });
    if( !geoLocation ) {
        throw new AppError(
            getMessage('nonSevereNotification.geoLocationNotFound', lang),
            404,
            `NSEVNOT_${ op }_GEOLOCATION_NOT_FOUND`
        );
    }
}

// The other source rule, shared by 001 and 004. It lives here and not in the validator because on
// update it is evaluated over the resulting state — what is stored merged with what arrives —
// and the validator only sees the body. It still answers 400: the problem is the combination of
// fields in the body, which is malformed input however it is checked.
// Sending a description when the answer is not YES is rejected instead of ignored: a description
// of another source under a "there was none" is a contradiction nobody would detect afterwards
const assertOtherSourceRule = (
    verifiedOtherSource: string | null | undefined,
    otherSourceDescription: string | null | undefined,
    op: string,
    lang: string
) => {
    const description = normalizeText(otherSourceDescription);

    if( verifiedOtherSource === 'YES' ) {
        if( !description ) {
            throw new AppError(
                getMessage('nonSevereNotification.otherSourceDescriptionRequired', lang),
                400,
                `NSEVNOT_${ op }_OTHER_SOURCE_DESCRIPTION_REQUIRED`
            );
        }
        return;
    }

    if( description ) {
        throw new AppError(
            getMessage('nonSevereNotification.otherSourceDescriptionNotAllowed', lang),
            400,
            `NSEVNOT_${ op }_OTHER_SOURCE_DESCRIPTION_NOT_ALLOWED`
        );
    }
}

// Create Non Severe Notification Service
// Code: ESAVI-NSEVNOT-001
const createNonSevereNotificationService = async (
    data: CreateNonSevereNotificationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertNotificationIsValid(data.notificationId, '001', lang);
    await assertDetailDoesNotExist(data.notificationId, '001', lang);

    // The three keys are optional, and a null is never resolved nor validated: dissociating is
    // always legal. Only a key arriving with a value reaches the database
    if( data.vaccinationHealthFacilityId ) {
        await assertVaccinationHealthFacilityIsValid(data.vaccinationHealthFacilityId, '001', lang);
    }
    if( data.vaccinationSiteItemId ) {
        await assertVaccinationSiteIsValid(data.vaccinationSiteItemId, '001', lang);
    }
    if( data.vaccinationGeoLocationId ) {
        await assertVaccinationGeoLocationIsValid(data.vaccinationGeoLocationId, '001', lang);
    }

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    assertOtherSourceRule(data.verifiedOtherSource, data.otherSourceDescription, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NSEVNOT-001',
        detail: 'Non severe notification detail created by service'
    };

    // The six tri-state fields keep their null: what does not arrive is stored null, never
    // NO_ANSWER and never false. deletedAt is born null and there is no isActive to set — the
    // header had to be active to get here, so a detail cannot be created already dragged
    await NonSevereNotification.create({
        notificationId: data.notificationId,
        vaccinationHealthFacilityId: data.vaccinationHealthFacilityId ?? null,
        vaccinationSiteItemId: data.vaccinationSiteItemId ?? null,
        vaccinationCenterAddress: normalizeText(data.vaccinationCenterAddress),
        vaccinationGeoLocationId: data.vaccinationGeoLocationId ?? null,
        verifiedPhysicalDocument: data.verifiedPhysicalDocument ?? null,
        verifiedElectronicRecord: data.verifiedElectronicRecord ?? null,
        verifiedVerbalReport: data.verifiedVerbalReport ?? null,
        verifiedClinicalRecord: data.verifiedClinicalRecord ?? null,
        verifiedUnknown: data.verifiedUnknown ?? null,
        verifiedOtherSource: data.verifiedOtherSource ?? null,
        otherSourceDescription: normalizeText(data.otherSourceDescription),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved header, its case and the three vaccination
    // objects, not just the raw identifiers
    const created = await findNonSevereNotificationWithRelations(data.notificationId, true);
    return created ? toNonSevereNotificationResponse(created) : null;
}

// Get Non Severe Notification By ID Service
// Code: ESAVI-NSEVNOT-003
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// header must be active unless canViewInactive says otherwise — today SUPERADMIN. Both failures
// answer the same 404 without distinguishing, because telling them apart would confirm to a USER
// that a detail exists under a notification it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// header, which is what makes it possible to consult it before purging it
const getNonSevereNotificationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const nonSevereNotification = await findNonSevereNotificationWithRelations(id, canViewInactive);
    if( !nonSevereNotification ) {
        throw new AppError(getMessage('nonSevereNotification.notFound', lang), 404, 'NSEVNOT_003_NOT_FOUND');
    }
    return toNonSevereNotificationResponse(nonSevereNotification);
}

// Get Non Severe Notification By Case ID Service
// Code: ESAVI-NSEVNOT-006
// The real query of the domain: the client holds the caseId, not the notificationId. It returns
// the record itself and not { count, rows } — the chain case -> notification -> detail is one to
// one on both hops, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The three 404 are deliberately distinct, and the asymmetry with 003 is intentional: there the
// client already holds the primary key of the detail, here it enters through a caseId and needs
// to know which link of the chain broke. A case whose notification is SEVERE falls in the third
const getNonSevereNotificationByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('nonSevereNotification.caseNotFound', lang), 404, 'NSEVNOT_006_CASE_NOT_FOUND');
    }

    const where = canViewInactive ? { caseId } : { caseId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('nonSevereNotification.notificationNotFound', lang),
            404,
            'NSEVNOT_006_NOTIFICATION_NOT_FOUND'
        );
    }

    const nonSevereNotification = await findNonSevereNotificationWithRelations(notification.notificationId, canViewInactive);
    if( !nonSevereNotification ) {
        throw new AppError(getMessage('nonSevereNotification.notFound', lang), 404, 'NSEVNOT_006_NOT_FOUND');
    }
    return toNonSevereNotificationResponse(nonSevereNotification);
}

export {
    createNonSevereNotificationService,
    getNonSevereNotificationByIdService,
    getNonSevereNotificationByCaseIdService
};
