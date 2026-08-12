import { CatalogItem, CatalogType, EsaviCase, Notification } from '../models';
import { AppError, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateNotificationInput } from '../types';

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
    // The four tri-state fields keep their null: what does not arrive is stored null, never
    // NO_ANSWER and never false. requestInvestigation is the exception — the DDL gave it a
    // DEFAULT false, which is the table saying that here "not informed" and "no" are the same.
    // Only the two free texts are normalized: this entity has neither `code` nor `name`
    const newNotification = await Notification.create({
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
    });

    // Re-read so the response carries the resolved case and outcome, not their ids
    const createdNotification = await findNotificationWithRelations(newNotification.notificationId, true);
    return createdNotification ? toNotificationResponse(createdNotification) : null;
}

export {
    createNotificationService
}
