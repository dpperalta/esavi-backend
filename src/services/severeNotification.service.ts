import { EsaviCase, Notification, SevereNotification } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateSevereNotificationInput } from '../types';
import { NotificationType } from '../constants/notification.constants';

// Only a SEVERE header admits a severe detail. A NON_SEVERE one never can, which is why the
// mismatch is a 409 against the state of another row and not a 400 about a malformed body
const SEVERE_TYPE: NotificationType = 'SEVERE';

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

// sysDetails is trigger metadata and never leaves the service. notificationId does travel,
// unlike the raw foreign keys of other entities: here it is the primary key of the row
const DETAIL_EXCLUDE = { exclude: ['sysDetails'] };

// The five tri-state fields are returned exactly as stored, null included: they are never
// normalized to NO_ANSWER nor to false when building the response. A null means the form did not
// collect the answer, and NO_ANSWER means the notifier deliberately gave none.
// There is no isActive to return — the table does not have that column. deletedAt is the only
// status mark the row carries, and notification.isActive is the real source
const toSevereNotificationResponse = (severeNotification: SevereNotification) => {
    const plain = severeNotification.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;

    const notification = plain.notification as Record<string, unknown> | null | undefined;
    if( notification ) delete notification.sysDetails;

    return plain;
}

// The read every operation shares to build its response. The include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so a detail hanging from a retired header simply does not come back
const findSevereNotificationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await SevereNotification.findOne({
        where: { notificationId: id },
        attributes: DETAIL_EXCLUDE,
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
            getMessage('severeNotification.notificationNotFound', lang),
            404,
            `SEVNOT_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }

    if( notification.notificationType !== SEVERE_TYPE ) {
        throw new AppError(
            getMessage('severeNotification.notificationNotSevere', lang, { notificationId }),
            409,
            `SEVNOT_${ op }_NOTIFICATION_NOT_SEVERE`
        );
    }
}

// The one to one is imposed by the primary key itself, which is also the foreign key: there is no
// extra UNIQUE because none is needed. The check is a findByPk of its own and does not rely on
// the collision — a 23505 would reach the client as a 500 and its Postgres message says nothing
// useful. The message carries the notificationId because otherwise the client sees a 409 about a
// row it did not name
const assertDetailDoesNotExist = async (notificationId: string, op: string, lang: string) => {
    const existing = await SevereNotification.findByPk(notificationId, { attributes: ['notificationId'] });
    if( existing ) {
        throw new AppError(
            getMessage('severeNotification.alreadyExists', lang, { notificationId }),
            409,
            `SEVNOT_${ op }_ALREADY_EXISTS`
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

// The pregnancy rule, shared by 001 and 004. It lives here and not in the validator because on
// update it is evaluated over the resulting state — what is stored merged with what arrives —
// and the validator only sees the body. It still answers 400: the problem is the combination of
// fields in the body, which is malformed input however it is checked.
// Sending a description when the answer is not YES is rejected instead of ignored: a description
// of complications under a "there were none" is a contradiction nobody would detect afterwards
const assertPregnancyRule = (
    hasPregnancyComplications: string | null | undefined,
    pregnancyComplicationsDescription: string | null | undefined,
    op: string,
    lang: string
) => {
    const description = normalizeText(pregnancyComplicationsDescription);

    if( hasPregnancyComplications === 'YES' ) {
        if( !description ) {
            throw new AppError(
                getMessage('severeNotification.pregnancyDescriptionRequired', lang),
                400,
                `SEVNOT_${ op }_PREGNANCY_DESCRIPTION_REQUIRED`
            );
        }
        return;
    }

    if( description ) {
        throw new AppError(
            getMessage('severeNotification.pregnancyDescriptionNotAllowed', lang),
            400,
            `SEVNOT_${ op }_PREGNANCY_DESCRIPTION_NOT_ALLOWED`
        );
    }
}

// Create Severe Notification Service
// Code: ESAVI-SEVNOT-001
const createSevereNotificationService = async (
    data: CreateSevereNotificationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    await assertNotificationIsValid(data.notificationId, '001', lang);
    await assertDetailDoesNotExist(data.notificationId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    assertPregnancyRule(data.hasPregnancyComplications, data.pregnancyComplicationsDescription, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-SEVNOT-001',
        detail: 'Severe notification detail created by service'
    };

    // The five tri-state fields keep their null: what does not arrive is stored null, never
    // NO_ANSWER and never false. deletedAt is born null and there is no isActive to set — the
    // header had to be active to get here, so a detail cannot be created already dragged
    await SevereNotification.create({
        notificationId: data.notificationId,
        hasPreviousEventHistory: data.hasPreviousEventHistory ?? null,
        hasAllergyToOtherVaccines: data.hasAllergyToOtherVaccines ?? null,
        hasAllergyToMedications: data.hasAllergyToMedications ?? null,
        hasAllergyToPreviousSameVaccine: data.hasAllergyToPreviousSameVaccine ?? null,
        hasPregnancyComplications: data.hasPregnancyComplications ?? null,
        pregnancyComplicationsDescription: normalizeText(data.pregnancyComplicationsDescription),
        notes: normalizeText(data.notes),
        appDetails: [newEntry]
    });

    // Re-read so the response carries the resolved header and its case, not just the shared id
    const created = await findSevereNotificationWithRelations(data.notificationId, true);
    return created ? toSevereNotificationResponse(created) : null;
}

// Get Severe Notification By ID Service
// Code: ESAVI-SEVNOT-003
// Two filters, and the second one is the inherited visibility: the row must exist, and its
// header must be active unless canViewInactive says otherwise — today SUPERADMIN. Both failures
// answer the same 404 without distinguishing, because telling them apart would confirm to a USER
// that a detail exists under a notification it is not allowed to see.
// The own deletedAt filters nothing: a dragged row is still readable by whoever can see its
// header, which is what makes it possible to consult it before purging it
const getSevereNotificationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const severeNotification = await findSevereNotificationWithRelations(id, canViewInactive);
    if( !severeNotification ) {
        throw new AppError(getMessage('severeNotification.notFound', lang), 404, 'SEVNOT_003_NOT_FOUND');
    }
    return toSevereNotificationResponse(severeNotification);
}

// Get Severe Notification By Case ID Service
// Code: ESAVI-SEVNOT-006
// The real query of the domain: the client holds the caseId, not the notificationId. It returns
// the record itself and not { count, rows } — the chain case -> notification -> detail is one to
// one on both hops, and wrapping a single record in a collection would force unwrapping a
// one-element array on every screen.
// The three 404 are deliberately distinct, and the asymmetry with 003 is intentional: there the
// client already holds the primary key of the detail, here it enters through a caseId and needs
// to know which link of the chain broke
const getSevereNotificationByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('severeNotification.caseNotFound', lang), 404, 'SEVNOT_006_CASE_NOT_FOUND');
    }

    const where = canViewInactive ? { caseId } : { caseId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('severeNotification.notificationNotFound', lang),
            404,
            'SEVNOT_006_NOTIFICATION_NOT_FOUND'
        );
    }

    const severeNotification = await findSevereNotificationWithRelations(notification.notificationId, canViewInactive);
    if( !severeNotification ) {
        throw new AppError(getMessage('severeNotification.notFound', lang), 404, 'SEVNOT_006_NOT_FOUND');
    }
    return toSevereNotificationResponse(severeNotification);
}

export {
    createSevereNotificationService,
    getSevereNotificationByIdService,
    getSevereNotificationByCaseIdService
}
