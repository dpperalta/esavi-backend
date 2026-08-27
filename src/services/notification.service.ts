import { Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, EsaviCase, Notification, NonSevereNotification, NotificationDiluent, NotificationEvent, NotificationMedication, NotificationPregnancy, NotificationPregnancyComplication, NotificationVaccine, SevereNotification } from '../models';
import { AppError, buildDifferentialUpdate, esaviLog, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationInput, NotificationListFilters } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { advanceCaseWorkflowStageService } from './caseWorkflow.service';
import { purgeEntityService } from './common/entityPurge.service';

// Code of the catalogType that groups the outcomes. Without this check any active catalogItem of
// the system would enter as an outcome and the death rule would never fire for the right one.
// catalogType codes are stored in camelCase — catalogType.service.ts:12
const OUTCOME_CATALOG_CODE = 'outcome';

// Code of the outcome item that turns the three death fields from forbidden into required.
// catalogItem codes are stored in CONSTANT_CASE — catalogItem.service.ts:22
const DEATH_OUTCOME_CODE = 'DEATH';

// The three fields that only make sense when the outcome is death
const DEATH_FIELDS = ['deathDate', 'autopsyRequested', 'verbalAutopsyPerformed'] as const;

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    // eventDate travels because it is the date a client contrasts deathDate against, even
    // though this spec does not validate that on the server
    attributes: ['caseId', 'caseCode', 'reportDate', 'eventDate']
};

const OUTCOME_INCLUDE = {
    model: CatalogItem,
    as: 'outcome',
    attributes: ['catalogItemId', 'code', 'name']
};

// sysDetails is trigger metadata and never leaves the service. The two raw foreign keys go with
// it: the response carries the resolved case and outcome objects instead
const DETAIL_EXCLUDE = { exclude: ['sysDetails', 'caseId', 'outcomeItemId'] };

// The reduced shape of the listings drops notes and appDetails, plus the three timestamps.
// esaviDescription does travel: it is the field that says what each notification is about, and a
// list without it forces opening every record to find out. notes stays out because it is free
// text with no length limit and dumping it on every row makes the response size unpredictable
const LIST_ATTRIBUTES = [
    'notificationId',
    'notificationType',
    'esaviDescription',
    'hasRelevantMedicalHistory',
    'takesMedication',
    'requestInvestigation',
    'deathDate',
    'autopsyRequested',
    'verbalAutopsyPerformed',
    'isActive'
];

// Newest first, the same order as classification, notifier and esaviCase
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// The four tri-state fields are returned exactly as stored, null included: they are never
// normalized to NO_ANSWER nor to false when building the response. A null means the form did not
// collect the answer, and NO_ANSWER means the notifier deliberately gave none
const toNotificationResponse = (notification: Notification) => {
    const plain = notification.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.caseId;
    delete plain.outcomeItemId;
    return plain;
}

// The read the write operations share to build their response
const findNotificationWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { notificationId: id } : { notificationId: id, isActive: true };
    return await Notification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [CASE_INCLUDE, OUTCOME_INCLUDE]
    });
}

// The same read as above, entered through the foreign key instead of the primary one. It needs
// no LIMIT beyond findOne because UQ_notification_case guarantees there is at most one row
const findNotificationByCaseId = async (caseId: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { caseId } : { caseId, isActive: true };
    return await Notification.findOne({
        where,
        attributes: DETAIL_EXCLUDE,
        include: [CASE_INCLUDE, OUTCOME_INCLUDE]
    });
}

// The case must exist and be active: FK_notification_case declares ON DELETE CASCADE, but
// TRG_esaviCase_preventPhysicalDelete forbids every physical delete of esaviCase, so that
// cascade never fires and nothing in the DDL stops a notification from pointing at a retired
// case. The operation code travels in so the AppError keeps it
const assertCaseIsValid = async (caseId: string, op: string, lang: string) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('notification.caseNotFound', lang), 404, `NOTIFCN_${ op }_CASE_NOT_FOUND`);
    }
}

// UQ_notification_case makes the relation one to one, and it does not filter by isActive: a
// caseId taken by a deactivated notification is still taken. Checking only the active ones would
// let through an INSERT that Postgres rejects with 23505, turning a 409 into a 500. The message
// carries the caseId because otherwise the client sees a 409 about a row it cannot see
const assertCaseIsNotNotified = async (caseId: string, op: string, lang: string) => {
    const existing = await Notification.findOne({
        where: { caseId },
        attributes: ['notificationId']
    });
    if( existing ) {
        throw new AppError(
            getMessage('notification.caseAlreadyNotified', lang, { caseId }),
            409,
            `NOTIFCN_${ op }_CASE_ALREADY_NOTIFIED`
        );
    }
}

// Resolves the outcome the client sent and returns its code. The item must exist, be active and
// belong to the outcome catalog: any other catalogItem would be a valid UUID pointing at a
// meaningless outcome. An unseeded outcome catalog makes every outcomeItemId fall here, which is
// the deployment precondition the spec declares
const resolveOutcomeCode = async (outcomeItemId: string, op: string, lang: string): Promise<string> => {
    const outcomeItem = await CatalogItem.findOne({
        where: { catalogItemId: outcomeItemId, isActive: true },
        attributes: ['catalogItemId', 'code'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: OUTCOME_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !outcomeItem ) {
        throw new AppError(getMessage('notification.outcomeNotFound', lang), 404, `NOTIFCN_${ op }_OUTCOME_NOT_FOUND`);
    }
    return outcomeItem.code ?? '';
}

// The death rule, shared by 001 and 004. It lives here and not in the validator because it hangs
// on the code of the catalogItem behind outcomeItemId, which the validator cannot see — it only
// gets an opaque UUID. It still answers 400: the problem is the combination of fields in the
// body, which is malformed input however it is checked.
// Sending the three fields under an outcome that is not death is rejected instead of ignored:
// there is no correct value to put in their place, and a death date stored under a recovery
// outcome is a contradiction nobody would ever detect
const assertDeathRule = (
    state: Partial<CreateNotificationInput>,
    outcomeCode: string | null,
    op: string,
    lang: string
) => {
    const isDeath = outcomeCode === DEATH_OUTCOME_CODE;
    const isInformed = (value: unknown): boolean => value !== undefined && value !== null;

    if( isDeath ) {
        // verbalAutopsyPerformed stays optional even here
        if( !isInformed(state.deathDate) || !isInformed(state.autopsyRequested) ) {
            throw new AppError(
                getMessage('notification.deathFieldsRequired', lang),
                400,
                `NOTIFCN_${ op }_DEATH_FIELDS_REQUIRED`
            );
        }
        return;
    }

    const informed = DEATH_FIELDS.filter((field) => isInformed(state[field]));
    if( informed.length > 0 ) {
        throw new AppError(
            getMessage('notification.deathFieldsNotAllowed', lang),
            400,
            `NOTIFCN_${ op }_DEATH_FIELDS_NOT_ALLOWED`
        );
    }
}

// Create Notification Service
// Code: ESAVI-NOTIFCN-001
const createNotificationService = async (data: CreateNotificationInput, authUser: AuthUser | undefined, lang: string) => {
    await assertCaseIsValid(data.caseId, '001', lang);
    await assertCaseIsNotNotified(data.caseId, '001', lang);

    // On create the body is the whole resulting state, so the rule is evaluated over it directly
    const outcomeCode = data.outcomeItemId ? await resolveOutcomeCode(data.outcomeItemId, '001', lang) : null;
    assertDeathRule(data, outcomeCode, '001', lang);

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFCN-001',
        detail: 'Notification created by service'
    };
    // Two dependent writes since SPEC F44 — the notification row and the stamp
    // ESAVI-CASEFLOW-012 puts on the workflow — so this service is transactional. A case whose
    // workflow cannot be advanced does not get a notification either
    const transaction = await sequelize.transaction();
    let newNotification: Notification;
    try {
        // The four tri-state fields keep their null: what does not arrive is stored null, never
        // NO_ANSWER and never false. requestInvestigation is the exception — the DDL gave it a
        // DEFAULT false, which is the table saying that here "not informed" and "no" are the same.
        // Only the two free texts are normalized: this entity has neither `code` nor `name`
        newNotification = await Notification.create({
            caseId: data.caseId,
            notificationType: data.notificationType,
            esaviDescription: data.esaviDescription.trim(),
            hasRelevantMedicalHistory: data.hasRelevantMedicalHistory ?? null,
            takesMedication: data.takesMedication ?? null,
            outcomeItemId: data.outcomeItemId ?? null,
            requestInvestigation: data.requestInvestigation ?? false,
            deathDate: data.deathDate ?? null,
            autopsyRequested: data.autopsyRequested ?? null,
            verbalAutopsyPerformed: data.verbalAutopsyPerformed ?? null,
            notes: data.notes ? data.notes.trim() : null,
            isActive: data.isActive !== undefined ? data.isActive : true,
            appDetails: [newEntry]
        }, { transaction });

        // ESAVI-CASEFLOW-012: seals notificationStartedAt, closes the classification stage if it
        // was left open and moves the file to IN_NOTIFICATION
        await advanceCaseWorkflowStageService(data.caseId, 'NOTIFICATION', authUser, lang, transaction);

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved case and outcome, not their ids
    const createdNotification = await findNotificationWithRelations(newNotification.notificationId, true);
    return createdNotification ? toNotificationResponse(createdNotification) : null;
}

// The four filters are accumulated with AND, and each one is optional and by equality. A filter
// pointing at a row that does not exist yields an empty page, never a 404: searching for
// something absent is an empty search, not a missing resource. requestInvestigation is compared
// against undefined and not by truthiness, or filtering by false would silently drop the condition
const buildListWhere = (filters: NotificationListFilters = {}): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;
    if( filters.notificationType ) where.notificationType = filters.notificationType;
    if( filters.requestInvestigation !== undefined ) where.requestInvestigation = filters.requestInvestigation;
    if( filters.outcomeItemId ) where.outcomeItemId = filters.outcomeItemId;

    return where as WhereOptions;
}

// Get Active Notifications Service
// Code: ESAVI-NOTIFCN-002A
// The where filters by the isActive of the notification, not by the one of its case: with the
// cascade of ESAVI-CASE-005A the notification of a retired case is already inactive, so the
// result is the same without conditioning the include with a required: true
const getNotificationsService = async (
    filters: NotificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Notification.findAndCountAll({
        where: { ...buildListWhere(filters), isActive: true },
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, OUTCOME_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get All Notifications Service - For Admin
// Code: ESAVI-NOTIFCN-002B
const getAllNotificationsService = async (
    filters: NotificationListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    return await Notification.findAndCountAll({
        where: buildListWhere(filters),
        attributes: LIST_ATTRIBUTES,
        include: [CASE_INCLUDE, OUTCOME_INCLUDE],
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get Notification By ID Service
// Code: ESAVI-NOTIFCN-003
const getNotificationByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const notification = await findNotificationWithRelations(id, canViewInactive);
    if( !notification ) {
        throw new AppError(getMessage('notification.notFound', lang), 404, 'NOTIFCN_003_NOT_FOUND');
    }
    return toNotificationResponse(notification);
}

// Get Notification By Case ID Service
// Code: ESAVI-NOTIFCN-006
// The real query of the domain: the client holds the caseId, not the notificationId. It returns
// the record itself and not { count, rows } — the relation is one to one, and wrapping a single
// record in a collection would force unwrapping a one-element array on every screen.
// The two 404 are deliberately distinct: a case that does not exist is a broken link, a case
// without notification is a pending task, and the client acts differently on each
const getNotificationByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    await assertCaseIsValid(caseId, '006', lang);

    const notification = await findNotificationByCaseId(caseId, canViewInactive);
    if( !notification ) {
        throw new AppError(getMessage('notification.notFound', lang), 404, 'NOTIFCN_006_NOT_FOUND');
    }
    return toNotificationResponse(notification);
}

// The code of an outcome already stored in the row, read without the active and catalog filters
// that resolveOutcomeCode applies. It is only needed to evaluate the death rule over the
// resulting state when the PUT does not touch outcomeItemId: answering 404 there would block
// correcting a notification whose outcome item was deactivated after the fact, which is not
// something the client did wrong
const readStoredOutcomeCode = async (outcomeItemId: string): Promise<string | null> => {
    const outcomeItem = await CatalogItem.findByPk(outcomeItemId, { attributes: ['code'] });
    return outcomeItem?.code ?? null;
}

// The three death fields and the outcome of the resulting state: what is stored merged with what
// arrives. A key absent from the body keeps its stored value; a key that arrives null erases it,
// which is how a PUT that moves the outcome away from DEATH clears them in the same request
const mergeDeathState = (
    notification: Notification,
    data: Partial<CreateNotificationInput>
): Partial<CreateNotificationInput> => {
    const merged: Record<string, unknown> = {};
    for( const field of DEATH_FIELDS ) {
        merged[field] = data[field] !== undefined ? ( data[field] ?? null ) : notification.getDataValue(field);
    }
    return merged as Partial<CreateNotificationInput>;
}

// Update Notification Service
// Code: ESAVI-NOTIFCN-004
// caseId and notificationType are ignored whether or not they arrive in the body. A notification
// is not moved between cases — the UNIQUE of the destination would block it anyway, and the
// origin would be left unnotified without anything recording it — and the type governs which
// satellite table the notification belongs to: changing it today, with none of the eight
// implemented, would leave orphan rows behind when they arrive
const updateNotificationService = async (
    id: string,
    data: Partial<CreateNotificationInput>,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const notification = await Notification.findByPk(id);
    if( !notification ) {
        throw new AppError(getMessage('notification.notFound', lang), 404, 'NOTIFCN_004_NOT_FOUND');
    }

    // The death rule is evaluated over the resulting state and not over the body: otherwise a PUT
    // moving the outcome from DEATH to RECOVERED without touching deathDate would leave the date
    // orphaned under an outcome that contradicts it. The validator cannot do this — it does not
    // see the row — so the same check is applied here instead
    const outcomeArrived = data.outcomeItemId !== undefined;
    const resultingOutcomeItemId = outcomeArrived ? ( data.outcomeItemId ?? null ) : notification.outcomeItemId;

    let outcomeCode: string | null = null;
    if( resultingOutcomeItemId ) {
        outcomeCode = outcomeArrived
            ? await resolveOutcomeCode(resultingOutcomeItemId, '004', lang)
            : await readStoredOutcomeCode(resultingOutcomeItemId);
    }
    assertDeathRule(mergeDeathState(notification, data), outcomeCode, '004', lang);

    // Differential update — SPEC F12: only what really changed reaches the UPDATE. Resending
    // whole the record just read with a GET is the normal use of a form, and writing it back
    // would fill appDetails with entries that record no change and hide the real ones among them.
    // A key absent from the body is undefined and is discarded; a key that arrives null is a
    // value, which is what keeps the tri-state alive. requestInvestigation never becomes null:
    // the validator rejects it, and an absent key leaves the stored boolean where it is
    const stored = notification.get({ plain: true }) as Record<string, unknown>;

    const objectToUpdate = buildDifferentialUpdate(stored, {
        esaviDescription: data.esaviDescription !== undefined ? data.esaviDescription.trim() : undefined,
        hasRelevantMedicalHistory: data.hasRelevantMedicalHistory !== undefined
            ? ( data.hasRelevantMedicalHistory ?? null ) : undefined,
        takesMedication: data.takesMedication !== undefined ? ( data.takesMedication ?? null ) : undefined,
        outcomeItemId: outcomeArrived ? resultingOutcomeItemId : undefined,
        requestInvestigation: data.requestInvestigation,
        // Written as a plain YYYY-MM-DD string, which is what a DATEONLY column reads back as
        deathDate: data.deathDate !== undefined
            ? ( data.deathDate ? String(data.deathDate).slice(0, 10) : null ) : undefined,
        autopsyRequested: data.autopsyRequested !== undefined ? ( data.autopsyRequested ?? null ) : undefined,
        verbalAutopsyPerformed: data.verbalAutopsyPerformed !== undefined
            ? ( data.verbalAutopsyPerformed ?? null ) : undefined,
        notes: data.notes !== undefined ? ( data.notes ? data.notes.trim() : null ) : undefined,
        isActive: data.isActive
    });

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
    // sysDetails.version bump that TRG_notification_setSysDetails fires on every write
    if( Object.keys(objectToUpdate).length === 0 ) {
        const unchanged = await findNotificationWithRelations(id, true);
        return unchanged ? toNotificationResponse(unchanged) : null;
    }

    // Written by hand so the service does not depend on a trigger for a column it owns: the
    // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
    objectToUpdate.updatedAt = new Date();

    // The history is extended, never overwritten
    const currentAppDetails = Array.isArray(notification.appDetails) ? notification.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-NOTIFCN-004',
        detail: 'Notification updated by service'
    };
    await notification.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });

    const updatedNotification = await findNotificationWithRelations(id, true);
    return updatedNotification ? toNotificationResponse(updatedNotification) : null;
}

// The severe detail joins the lifecycle of its header, in the same transaction the activation
// already opens. SPEC F13 adds this satellite to the mechanism SPEC F07 left in place, with one
// difference declared there: severeNotification has no isActive column — the schema decided the
// satellites do not manage their own state — so what the cascade moves is its deletedAt.
//
// It is one row at most, because the primary key of the detail is the foreign key to this
// header, so it is read and written as an instance instead of with a mass update: the history is
// preserved by spreading the array, the same way the rest of this service does it.
//
// The method is the code of the operation that dragged it, never an ESAVI-SEVNOT-005*: that one
// would suggest somebody retired this detail on its own, and there is no way to do that
const cascadeSealSevereNotification = async (
    notificationId: string,
    authUser: AuthUser | undefined,
    transaction: Transaction
) => {
    const severeNotification = await SevereNotification.findOne({ where: { notificationId }, transaction });

    // A notification with no detail drags zero rows and does not fail. A detail that was already
    // sealed keeps its original date and receives no new entry: the fact was already recorded
    if( !severeNotification || severeNotification.deletedAt ) {
        return;
    }

    const now = new Date();
    const currentAppDetails = Array.isArray(severeNotification.appDetails) ? severeNotification.appDetails : [];
    await severeNotification.update({
        deletedAt: now,
        updatedAt: now,
        appDetails: [
            ...currentAppDetails,
            {
                createdAt: now,
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-NOTIFCN-005A',
                detail: 'Severe notification detail sealed by cascade from its Notification'
            }
        ]
    }, { transaction });
}

// The other half, and the first upward cascade of the repository: it breaks the "downwards only"
// criterion SPEC F07 fixed, and the exception travels with its own boundary. notifier and
// classification are entities with a life of their own that somebody may have retired
// separately, and respecting that decision when the parent comes back is correct. Here the
// detail has no decision of its own to respect — there is no way to retire it without retiring
// the header — so leaving it sealed would produce an active notification whose detail is marked
// as deleted, a state no client knows how to represent.
// That is also what keeps deactivate-then-reactivate a round trip: without this half the detail
// would stay marked forever, and purgable by accident
const cascadeClearSevereNotification = async (
    notificationId: string,
    authUser: AuthUser | undefined,
    transaction: Transaction
) => {
    const severeNotification = await SevereNotification.findOne({ where: { notificationId }, transaction });

    // Nothing sealed is nothing to clear, and an entry recording no change is noise
    if( !severeNotification || !severeNotification.deletedAt ) {
        return;
    }

    const now = new Date();
    const currentAppDetails = Array.isArray(severeNotification.appDetails) ? severeNotification.appDetails : [];
    await severeNotification.update({
        deletedAt: null,
        updatedAt: now,
        appDetails: [
            ...currentAppDetails,
            {
                createdAt: now,
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-NOTIFCN-005B',
                detail: 'Severe notification detail cleared by cascade from its Notification'
            }
        ]
    }, { transaction });
}

// The non severe branch, sibling of the two above and written beside them rather than merged
// with them. SPEC F14 adds the second satellite to the same mechanism, with the same criterion
// for `method` and the same upward-cascade exception.
//
// A notification holds at most one of the two branches, because notificationType is unique per
// row: the cascade attempts both and one of them always finds zero rows. That is not an error and
// deserves no log — it is the normal outcome of the branch that does not apply
const cascadeSealNonSevereNotification = async (
    notificationId: string,
    authUser: AuthUser | undefined,
    transaction: Transaction
) => {
    const nonSevereNotification = await NonSevereNotification.findOne({ where: { notificationId }, transaction });

    // A notification with no detail drags zero rows and does not fail. A detail that was already
    // sealed keeps its original date and receives no new entry: the fact was already recorded
    if( !nonSevereNotification || nonSevereNotification.deletedAt ) {
        return;
    }

    const now = new Date();
    const currentAppDetails = Array.isArray(nonSevereNotification.appDetails) ? nonSevereNotification.appDetails : [];
    await nonSevereNotification.update({
        deletedAt: now,
        updatedAt: now,
        appDetails: [
            ...currentAppDetails,
            {
                createdAt: now,
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-NOTIFCN-005A',
                detail: 'Non severe notification detail sealed by cascade from its Notification'
            }
        ]
    }, { transaction });
}

// The other half for the non severe branch, with the same reasoning as its severe sibling: the
// detail has no decision of its own to respect, so leaving it sealed under an active header would
// produce a state no client knows how to represent
const cascadeClearNonSevereNotification = async (
    notificationId: string,
    authUser: AuthUser | undefined,
    transaction: Transaction
) => {
    const nonSevereNotification = await NonSevereNotification.findOne({ where: { notificationId }, transaction });

    // Nothing sealed is nothing to clear, and an entry recording no change is noise
    if( !nonSevereNotification || !nonSevereNotification.deletedAt ) {
        return;
    }

    const now = new Date();
    const currentAppDetails = Array.isArray(nonSevereNotification.appDetails) ? nonSevereNotification.appDetails : [];
    await nonSevereNotification.update({
        deletedAt: null,
        updatedAt: now,
        appDetails: [
            ...currentAppDetails,
            {
                createdAt: now,
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-NOTIFCN-005B',
                detail: 'Non severe notification detail cleared by cascade from its Notification'
            }
        ]
    }, { transaction });
}

// Setting Notification Active/Inactive Service
// Code: ESAVI-NOTIFCN-005A / ESAVI-NOTIFCN-005B
// Reactivating does NOT require the case to be active, for the same reason as in notifier and
// classification: the cascade only goes down, and whoever reactivates is SUPERADMIN. There can be
// no conflict with UQ_notification_case either, because the caseId was never released — step 2 of
// 001 prevents a second notification from waiting for the slot
const setNotificationActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // The where filters by the primary key only: the generic service is the one that tells
        // 'does not exist' (404) from 'already in that state' (409)
        await setEntityActiveStatusService({
            model: Notification,
            where: { notificationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('notification.notFound', lang),
            notFoundCode: `NOTIFCN_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`notification.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `NOTIFCN_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-NOTIFCN-${ op }`,
                detail: `Notification ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });

        // After the generic service, so a 404 or a 409 aborts before touching the detail: an
        // activation that answers 'already in that state' must leave everything as it was
        if( isActive ) {
            await cascadeClearSevereNotification(id, authUser, transaction);
            await cascadeClearNonSevereNotification(id, authUser, transaction);
        } else {
            await cascadeSealSevereNotification(id, authUser, transaction);
            await cascadeSealNonSevereNotification(id, authUser, transaction);
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// What the ON DELETE CASCADE of FK_severeNotification_notification is about to destroy, written
// down before it is gone. purgeEntityService leans on its dump being "the only trace left of an
// irreversible operation", and that dump only covers the row deleted explicitly: what the
// Postgres cascade takes with it would disappear without anything ever having written it.
//
// It is a trace, not a protection: the purge is not blocked, and the cascade still fires. The
// alternative — answering 409 when the notification has a detail, and demanding it be purged
// first — turns one operation into two and would have to be repeated for the seven remaining
// satellites, nine calls in the right order to purge a single notification.
//
// It never blocks the purge: a failure writing the log must not abort an operation the caller
// already authorized
const dumpSevereNotificationBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const severeNotification = await SevereNotification.findOne({
            where: { notificationId },
            transaction
        });
        if( !severeNotification ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: severeNotification row dragged by ON DELETE CASCADE and purged by ` +
            `${ userId }. Snapshot: ${ JSON.stringify(severeNotification.get({ plain: true })) }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged severeNotification: ${ error }`, 'error');
    }
}

// The same dump for the non severe branch, added beside its sibling. The two branches are
// mutually exclusive by notificationType, so a notification with a detail leaves exactly two
// entries in the log — the one of the notification itself, written by purgeEntityService, and the
// one of its single detail — and never three
const dumpNonSevereNotificationBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const nonSevereNotification = await NonSevereNotification.findOne({
            where: { notificationId },
            transaction
        });
        if( !nonSevereNotification ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: nonSevereNotification row dragged by ON DELETE CASCADE and purged by ` +
            `${ userId }. Snapshot: ${ JSON.stringify(nonSevereNotification.get({ plain: true })) }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged nonSevereNotification: ${ error }`, 'error');
    }
}

// The dump of the third satellite, and the first one that is not a single row: notificationEvent
// is one to many, so N events hang from the notification. One single warn line with the count and
// the list of eventId, never the content of the rows: dumping N whole rows turns a warning into
// noise, and dumping nothing leaves a destruction with no trace. The identifiers are enough to
// cross the line with the audit each event carried before it was destroyed.
// A notification with no events leaves no line at all
const dumpNotificationEventsBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notificationEvents = await NotificationEvent.findAll({
            where: { notificationId },
            attributes: ['eventId'],
            paranoid: false,
            transaction
        });
        if( notificationEvents.length === 0 ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: ${ notificationEvents.length } notificationEvent row(s) dragged by ` +
            `ON DELETE CASCADE and purged by ${ userId }. eventId: ` +
            `${ notificationEvents.map(( notificationEvent ) => notificationEvent.eventId).join(', ') }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationEvents: ${ error }`, 'error');
    }
}

// The dump of the fourth satellite, and the second one to many: N medications hang from the
// notification, so it follows the shape of the events above — one single warn line with the count
// and the list of medicationId, never the content of the rows.
// A notification with no medications leaves no line at all
const dumpNotificationMedicationsBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notificationMedications = await NotificationMedication.findAll({
            where: { notificationId },
            attributes: ['medicationId'],
            paranoid: false,
            transaction
        });
        if( notificationMedications.length === 0 ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: ${ notificationMedications.length } notificationMedication row(s) dragged by ` +
            `ON DELETE CASCADE and purged by ${ userId }. medicationId: ` +
            `${ notificationMedications.map(( notificationMedication ) => notificationMedication.medicationId).join(', ') }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationMedications: ${ error }`, 'error');
    }
}

// The dump of the fifth satellite, and the third one to many: N vaccines hang from the
// notification, so it follows the shape of the events and the medications above — one single warn
// line with the count and the list of vaccineId, never the content of the rows.
// A notification with no vaccines leaves no line at all.
//
// The notificationDiluent rows that fall in the second hop — they hang from vaccineId, not from
// notificationId — get their own dump right below, which SPEC F24 added when that table finally
// received a model
const dumpNotificationVaccinesBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notificationVaccines = await NotificationVaccine.findAll({
            where: { notificationId },
            attributes: ['vaccineId'],
            paranoid: false,
            transaction
        });
        if( notificationVaccines.length === 0 ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: ${ notificationVaccines.length } notificationVaccine row(s) dragged by ` +
            `ON DELETE CASCADE and purged by ${ userId }. vaccineId: ` +
            `${ notificationVaccines.map(( notificationVaccine ) => notificationVaccine.vaccineId).join(', ') }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationVaccines: ${ error }`, 'error');
    }
}

// The dump of the sixth satellite, and the only one this cascade reaches in two hops:
// notificationDiluent hangs from vaccineId and not from notificationId, so destroying the header
// drags it through notification -> notificationVaccine -> notificationDiluent. It is walked with the
// hasMany the associations of SPEC F24 declare, without raw SQL: the table has a model now, which is
// the very reason SPEC F22 could not write this line and left it promised instead.
//
// One single warn line with the count and the list of diluentId, as its five sisters. A notification
// whose vaccines carry no diluents leaves no line at all
const dumpNotificationDiluentsBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notificationVaccines = await NotificationVaccine.findAll({
            where: { notificationId },
            attributes: ['vaccineId'],
            include: [{
                model: NotificationDiluent,
                as: 'diluents',
                attributes: ['diluentId'],
                required: true
            }],
            paranoid: false,
            transaction
        });
        const diluentIds = notificationVaccines.flatMap(( notificationVaccine ) =>
            ( ( notificationVaccine.get('diluents') as NotificationDiluent[] | undefined ) ?? [] )
                .map(( notificationDiluent ) => notificationDiluent.diluentId)
        );
        if( diluentIds.length === 0 ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: ${ diluentIds.length } notificationDiluent row(s) dragged by ` +
            `ON DELETE CASCADE in the second hop and purged by ${ userId }. diluentId: ` +
            `${ diluentIds.join(', ') }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationDiluents: ${ error }`, 'error');
    }
}

// The dump of the seventh satellite. notificationPregnancy hangs straight from notificationId, so
// this cascade reaches it in a single hop — unlike the diluents above — and it is walked with the
// hasOne the associations of SPEC F25 declare, without raw SQL.
//
// One single warn line, and at most one: UQ_notificationPregnancy_notification makes the relation one
// to one, so this is a snapshot like the two detail branches and not a list like the four one to many
// sisters. A notification with no pregnancy leaves no line at all.
//
// What this line does NOT dump is what hangs one level further down: purging the header destroys the
// pregnancy, and the pregnancy drags its own notificationPregnancyComplication rows with it. That is
// the third hop, and it has its own dump right below since SPEC F27 gave that table a model
const dumpNotificationPregnancyBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notification = await Notification.findOne({
            where: { notificationId },
            attributes: ['notificationId'],
            include: [{
                model: NotificationPregnancy,
                as: 'pregnancy',
                required: true
            }],
            paranoid: false,
            transaction
        });
        const notificationPregnancy = notification?.get('pregnancy') as NotificationPregnancy | undefined;
        if( !notificationPregnancy ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: notificationPregnancy row dragged by ON DELETE CASCADE and purged by ` +
            `${ userId }. pregnancyId: ${ notificationPregnancy.pregnancyId }. ` +
            `Snapshot: ${ JSON.stringify(notificationPregnancy.get({ plain: true })) }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationPregnancy: ${ error }`, 'error');
    }
}

// The dump of the eighth and last satellite, and the deepest one this cascade reaches: purging the
// header drags it through notification -> notificationPregnancy -> notificationPregnancyComplication.
// It is the second dump of a third hop — the first was the diluents' second hop — and it is walked
// with the hasOne of SPEC F25 plus the hasMany of SPEC F27, without raw SQL.
//
// Without this line, purging a notification destroyed complications in a third hop leaving no trace
// anywhere, which is exactly what F22 avoided for the vaccines and F24 for the diluents.
//
// One single warn line with the count and the list of complicationId. A notification with a pregnancy
// that carries no complications leaves no line at all, and neither does one with no pregnancy
const dumpNotificationPregnancyComplicationsBeforeCascade = async (
    notificationId: string,
    userId: string,
    transaction: Transaction
) => {
    try {
        const notification = await Notification.findOne({
            where: { notificationId },
            attributes: ['notificationId'],
            include: [{
                model: NotificationPregnancy,
                as: 'pregnancy',
                attributes: ['pregnancyId'],
                required: true,
                include: [{
                    model: NotificationPregnancyComplication,
                    as: 'complications',
                    attributes: ['complicationId'],
                    required: true
                }]
            }],
            paranoid: false,
            transaction
        });
        const notificationPregnancy = notification?.get('pregnancy') as NotificationPregnancy | undefined;
        const complicationIds = ( ( notificationPregnancy?.get('complications') as NotificationPregnancyComplication[] | undefined ) ?? [] )
            .map(( complication ) => complication.complicationId);
        if( complicationIds.length === 0 ) {
            return;
        }
        esaviLog(
            `ESAVI-NOTIFCN-005C: ${ complicationIds.length } notificationPregnancyComplication row(s) dragged by ` +
            `ON DELETE CASCADE in the third hop and purged by ${ userId }. complicationId: ` +
            `${ complicationIds.join(', ') }`,
            'warn'
        );
    } catch (error) {
        esaviLog(`ESAVI-NOTIFCN-005C: Failed to dump the dragged notificationPregnancyComplications: ${ error }`, 'error');
    }
}

// Purging Notification Service - For SuperAdmin
// Code: ESAVI-NOTIFCN-005C
// notification is outside the preventPhysicalDelete loop of esaviapp.sql:1363-1366, so the row
// can really be destroyed. This is the only path that releases the caseId: once the row is gone
// UQ_notification_case is free and the case admits a new notification. It does not touch the
// case — the foreign key runs from the notification to the case and not the other way round.
// The eight tables that hang from notificationId declare ON DELETE CASCADE, so this operation
// drags the whole detailed notification with it without asking. SPEC F13 landed the first of
// them and did that review: the cascade is left to fire, with the log dumps above as its only
// mitigation. SPEC F14 landed the second one, and the six remaining satellites join those dumps
// as they are implemented
const purgeNotificationService = async (id: string, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        // Only when the row exists and is already inactive, which is exactly when the generic
        // service will go ahead: dumping before its guards would leave the log claiming a purge
        // that answered 404 or 409 and never happened
        const notification = await Notification.findOne({
            where: { notificationId: id },
            attributes: ['notificationId', 'isActive'],
            paranoid: false,
            transaction
        });
        if( notification && notification.isActive === false ) {
            await dumpSevereNotificationBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNonSevereNotificationBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationEventsBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationMedicationsBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationVaccinesBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationDiluentsBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationPregnancyBeforeCascade(id, authUser?.userId || 'undefined', transaction);
            await dumpNotificationPregnancyComplicationsBeforeCascade(id, authUser?.userId || 'undefined', transaction);
        }

        await purgeEntityService({
            model: Notification,
            where: { notificationId: id },
            transaction,
            operationCode: 'ESAVI-NOTIFCN-005C',
            userId: authUser?.userId || 'undefined',
            notFoundMessage: getMessage('notification.notFound', lang),
            notFoundCode: 'NOTIFCN_005C_NOT_FOUND',
            stillActiveMessage: getMessage('notification.stillActive', lang, { id }),
            stillActiveCode: 'NOTIFCN_005C_STILL_ACTIVE'
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNotificationService,
    getNotificationsService,
    getAllNotificationsService,
    getNotificationByIdService,
    getNotificationByCaseIdService,
    updateNotificationService,
    setNotificationActivationService,
    purgeNotificationService
}
