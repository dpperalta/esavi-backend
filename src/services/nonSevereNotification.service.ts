import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, GeoLocation, HealthFacility, Notification, NonSevereNotification } from '../models';
import { AppError, assertRowIsSealed, buildDifferentialUpdate, getMessage } from '../helpers';
import { purgeEntityService } from './common/entityPurge.service';
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
// normalized to false when building the response. A null means the form did not collect the
// answer, and false means the notifier deliberately answered no.
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

// The same read as above without narrowing the attributes of the detail, which is the
// precondition of buildDifferentialUpdate: an instance read with a narrowed `attributes` reads
// back undefined for the columns it left out, and every comparison against undefined would count
// as a change. It still carries the header include, so the inherited visibility is checked in the
// same query the update instance comes from. The three vaccination includes are left out on
// purpose: the update compares raw foreign keys, not resolved objects
const findNonSevereNotificationRow = async (id: string, includeInactive: boolean = false) => {
    return await NonSevereNotification.findOne({
        where: { notificationId: id },
        include: [{
            ...NOTIFICATION_INCLUDE,
            required: true,
            where: includeInactive ? {} : { isActive: true }
        }]
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
// Sending a description when the answer is not true is rejected instead of ignored: a description
// of another source under a "there was none" is a contradiction nobody would detect afterwards.
// The comparison is strict against true, so false and null behave alike here — neither of them
// declares another source, whatever the difference between them means elsewhere
const assertOtherSourceRule = (
    verifiedOtherSource: boolean | null | undefined,
    otherSourceDescription: string | null | undefined,
    op: string,
    lang: string
) => {
    const description = normalizeText(otherSourceDescription);

    if( verifiedOtherSource === true ) {
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

    // The six tri-state fields keep their null: what does not arrive is stored null and never
    // false. deletedAt is born null and there is no isActive to set — the
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

// Update Non Severe Notification Service
// Code: ESAVI-NSEVNOT-004
// notificationId is ignored whether or not it arrives in the body. It is the primary key of the
// row and the foreign key to its header at the same time: changing it is not updating this
// detail, it is creating another one under a different notification
const updateNonSevereNotificationService = async (
    id: string,
    data: Partial<CreateNonSevereNotificationInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const nonSevereNotification = await findNonSevereNotificationRow(id, canViewInactive);
    if( !nonSevereNotification ) {
        throw new AppError(getMessage('nonSevereNotification.notFound', lang), 404, 'NSEVNOT_004_NOT_FOUND');
    }

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending
    // whole the record just read with a GET is the normal use of a form, and writing it back
    // would fill appDetails with entries that record no change and hide the real ones among them.
    // The twelve fields are compared against undefined and never by truthiness: an `if( data.x )`
    // would silently discard the empty string and, above all, would make it impossible to clear a
    // field. Here that matters twice over, because null and false are different data and
    // dissociating a health facility by sending its key null is a legitimate edit
    const stored = nonSevereNotification.get({ plain: true }) as Record<string, unknown>;

    const candidates: Record<string, unknown> = {
        vaccinationHealthFacilityId: data.vaccinationHealthFacilityId !== undefined
            ? ( data.vaccinationHealthFacilityId ?? null ) : undefined,
        vaccinationSiteItemId: data.vaccinationSiteItemId !== undefined
            ? ( data.vaccinationSiteItemId ?? null ) : undefined,
        vaccinationGeoLocationId: data.vaccinationGeoLocationId !== undefined
            ? ( data.vaccinationGeoLocationId ?? null ) : undefined,
        // The three free texts are normalized before comparing, or a body differing only in
        // surrounding blanks would count as a change
        vaccinationCenterAddress: data.vaccinationCenterAddress !== undefined
            ? normalizeText(data.vaccinationCenterAddress) : undefined,
        verifiedPhysicalDocument: data.verifiedPhysicalDocument !== undefined
            ? ( data.verifiedPhysicalDocument ?? null ) : undefined,
        verifiedElectronicRecord: data.verifiedElectronicRecord !== undefined
            ? ( data.verifiedElectronicRecord ?? null ) : undefined,
        verifiedVerbalReport: data.verifiedVerbalReport !== undefined
            ? ( data.verifiedVerbalReport ?? null ) : undefined,
        verifiedClinicalRecord: data.verifiedClinicalRecord !== undefined
            ? ( data.verifiedClinicalRecord ?? null ) : undefined,
        verifiedUnknown: data.verifiedUnknown !== undefined
            ? ( data.verifiedUnknown ?? null ) : undefined,
        verifiedOtherSource: data.verifiedOtherSource !== undefined
            ? ( data.verifiedOtherSource ?? null ) : undefined,
        otherSourceDescription: data.otherSourceDescription !== undefined
            ? normalizeText(data.otherSourceDescription) : undefined,
        notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
    };

    // A foreign key is resolved only when its value really changes, and this is a declared
    // deviation from the canonical order — the canon validates foreign keys before the diff.
    // A PUT resending the GET whole must not fail because a health facility was deactivated
    // afterwards: the row is a historical record of where the vaccination happened, not a live
    // pointer. The assumed consequence: a PUT pointing at an inactive key answers 404 only if it
    // is changing it; resending it unchanged answers 200 without touching anything.
    // A null is never resolved either — dissociating is always legal
    const changesTo = (field: string): string | null => {
        const candidate = candidates[field];
        if( candidate === undefined || candidate === null ) return null;
        if( candidate === stored[field] ) return null;
        return candidate as string;
    }

    const newHealthFacilityId = changesTo('vaccinationHealthFacilityId');
    if( newHealthFacilityId ) {
        await assertVaccinationHealthFacilityIsValid(newHealthFacilityId, '004', lang);
    }
    const newSiteItemId = changesTo('vaccinationSiteItemId');
    if( newSiteItemId ) {
        await assertVaccinationSiteIsValid(newSiteItemId, '004', lang);
    }
    const newGeoLocationId = changesTo('vaccinationGeoLocationId');
    if( newGeoLocationId ) {
        await assertVaccinationGeoLocationIsValid(newGeoLocationId, '004', lang);
    }

    // The other source rule is evaluated over the resulting state and not over the body:
    // otherwise a PUT moving verifiedOtherSource from true to false without touching the
    // description would leave the text orphaned under an answer that contradicts it. Moving off true
    // therefore requires clearing the description in the same PUT, sending it null. The validator
    // cannot do this — it does not see the row — so the same check is applied here instead
    const resultingAnswer = candidates.verifiedOtherSource !== undefined
        ? candidates.verifiedOtherSource
        : ( nonSevereNotification.verifiedOtherSource ?? null );
    const resultingDescription = candidates.otherSourceDescription !== undefined
        ? candidates.otherSourceDescription
        : ( nonSevereNotification.otherSourceDescription ?? null );

    assertOtherSourceRule(
        resultingAnswer as boolean | null,
        resultingDescription as string | null,
        '004',
        lang
    );

    const objectToUpdate = buildDifferentialUpdate(stored, candidates);

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_nonSevereNotification_setSysDetails fires on every write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findNonSevereNotificationWithRelations(id, true);
        return unchanged ? toNonSevereNotificationResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(nonSevereNotification.appDetails) ? nonSevereNotification.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NSEVNOT-004',
        detail: 'Non severe notification detail updated by service'
    };
    await nonSevereNotification.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updated = await findNonSevereNotificationWithRelations(id, true);
    return updated ? toNonSevereNotificationResponse(updated) : null;
}

// Purging Non Severe Notification Service - For SuperAdmin
// Code: ESAVI-NSEVNOT-005C
// nonSevereNotification is outside the preventPhysicalDelete loop of esaviapp.sql:1354-1360, so
// the row can really be destroyed.
// The guard by deletedAt is assertRowIsSealed, shared with severeNotification: it lives in a
// helper and not in purgeEntityService, whose isActive check is inert on this table —
// `undefined !== true`, so every row would be purgable immediately and the safety net that
// CONVENTIONS.md §6 calls for would be gone.
// The three ON DELETE RESTRICT keys do not get in the way here: they point outwards, so purging
// this detail violates none of them. What they do forbid is purging the health facility, the
// catalog item or the location this row points at
const purgeNonSevereNotificationService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        const nonSevereNotification = await NonSevereNotification.findByPk(id, {
            attributes: ['notificationId', 'deletedAt'],
            transaction
        });
        if( !nonSevereNotification ) {
            throw new AppError(getMessage('nonSevereNotification.notFound', lang), 404, 'NSEVNOT_005C_NOT_FOUND');
        }

        assertRowIsSealed(nonSevereNotification, 'NSEVNOT_005C_NOT_DELETED', lang);

        await purgeEntityService({
            model: NonSevereNotification,
            where: { notificationId: id },
            transaction,
            operationCode: 'ESAVI-NSEVNOT-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('nonSevereNotification.notFound', lang),
            notFoundCode: 'NSEVNOT_005C_NOT_FOUND',
            // Unreachable on this table: the generic guard compares isActive, a column
            // nonSevereNotification does not have. The real guard is the one above
            stillActiveMessage: getMessage('nonSevereNotification.notDeleted', lang, { id }),
            stillActiveCode: 'NSEVNOT_005C_NOT_DELETED'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNonSevereNotificationService,
    getNonSevereNotificationByIdService,
    getNonSevereNotificationByCaseIdService,
    updateNonSevereNotificationService,
    purgeNonSevereNotificationService
};
