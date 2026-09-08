import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiagnosticTerm, Notification, NotificationMedicalHistory } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { AppDetails, AuthUser, CreateNotificationMedicalHistoryInput } from '../types';
import { TermSource } from '../constants/enums.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The source that admits implicit creation, and the only one the resolver of F15 ever writes: a
// client cannot coin a MedDRA or WHODrug term by typing one into a form
const LOCAL_SOURCE: TermSource = 'LOCAL';

// The columns the INSERT of ESAVI-MEDHIST-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and TRG_notificationMedicalHistory_setSortOrder
// would never get to assign it. Passing the field list is what makes the column absent from the
// statement. medicalHistoryId is out for the same reason it is out of the body: gen_random_uuid()
// writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationMedicalHistory>)[] = [
    'notificationId',
    'diagnosticTermId',
    'historyRaw',
    'notes',
    'isActive',
    'appDetails'
];

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails
// is trigger bookkeeping and never leaves the service, and an explicit list is what keeps it out
// without having to mention it
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<NotificationMedicalHistory>)[] = [
    'medicalHistoryId',
    'notificationId',
    'diagnosticTermId',
    'historyRaw',
    'sortOrder',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent, read on every operation to implement the inherited visibility. A single hop, unlike
// the two of investigationPregnancyCondition: notification carries its own isActive, so the state
// is read in one go and there is no chain to walk.
//
// The notification never reaches the response: whoever needs it enters through ESAVI-NOTIFCN-003,
// and hasRelevantMedicalHistory is not returned here either
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'isActive']
};

// The resolved master term, with six fields. The jsonb column of the master stays out: it carries
// the internal markers of the implicit resolution — autoCreated, reviewStatus — which are
// governance of the catalog and not data of the notification. It is the decision of F16, F27 and
// F33, literal.
//
// The include does not filter by isActive, deliberately: a term retired after the record was
// written still says what the antecedent was coded as
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// The parent is dropped here after having done its job in the query, and the master term comes back
// as an explicit null when the antecedent was notified without a code, so a client does not have to
// tell "empty" from "absent".
//
// The name the client displays is historyRaw ?? diagnosticTerm.name. There is no third field
// resolving it, and that is the simplification the DDL imposes: when historyRaw is null the
// notifier wrote exactly what the master says
const toNotificationMedicalHistoryResponse = (medicalHistory: NotificationMedicalHistory) => {
    const plain = medicalHistory.toJSON() as Record<string, unknown>;
    delete plain.notification;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;

    return plain;
}

// The notification must exist and be active: a retired notification does not take new antecedents.
// notificationType is deliberately not checked — an antecedent is recorded the same way on a severe
// notification as on a non severe one, which is the literal decision of F21 §3.5.
//
// Neither is hasRelevantMedicalHistory read here. The flag is form data written only by
// ESAVI-NOTIFCN-004, the list is clinical data, and replicating the parent's rule in the child would
// duplicate the source of truth. A notification answering 'NO' takes an antecedent and answers 201.
//
// The two reasons — it does not exist, it is inactive — share code and message: telling them apart
// is of no use to the notifier, and distinguishing them would confirm to a USER that a notification
// exists which it is not allowed to see
const findValidNotification = async (notificationId: string, op: string, lang: string) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId', 'isActive']
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationMedicalHistory.notificationNotFound', lang),
            404,
            `MEDHIST_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
    return notification;
}

// The same check as findValidNotification, relaxed by canViewInactive: the inherited visibility
// applied to the listings, where the parent is not the target of the write but the gate to the
// collection. A retired notification answers 404 for USER and ADMIN, and comes back for whoever may
// see inactive rows, today SUPERADMIN.
//
// Only the state is relaxed. Existence is relaxed for nobody: a notification that does not exist has
// no antecedents to list under any role, and answering an empty page would be a different lie.
//
// A retired notification answers 404 instead of an empty page, because an empty page would say
// "this notification has no antecedents" to somebody who is simply not allowed to see them
const assertNotificationIsVisible = async (
    notificationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const notification = await Notification.findOne({
        where: canViewInactive ? { notificationId } : { notificationId, isActive: true },
        attributes: ['notificationId']
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationMedicalHistory.notificationNotFound', lang),
            404,
            `MEDHIST_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. Neither goes through toTitleCase or toConstantCase: historyName and notes are the
// copy of what the notifier wrote and their only value is reproducing it. The one value that does
// get constant cased is the code, and only inside the resolution — where it is the key of the
// master lookup and never a column of this table.
//
// This is the ninth copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending, because doing it here would drag eight foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// What the resolution against the clinical master leaves behind: two derived values and not three.
// This table has a single text column, so there is nowhere to denormalize the canonical name or the
// code — both are read from diagnosticTerm through the include, and that is the simplification the
// DDL imposes
interface ResolvedMedicalHistoryTerm {
    diagnosticTermId: string | null;
    historyRaw: string | null;
}

// The resolution of ESAVI-MEDHIST-001 and 004, in three branches.
//
// Without a code there is no term: the name is the free text of the notifier and there is nothing to
// diverge from, so historyRaw keeps it as it is. With a code and LOCAL — or no source at all — the
// resolver of F15 answers, creating the term when it does not exist yet, which is the whole point of
// the implicit resolution. With a code and an external source the pair (source, code) is looked up
// and nothing is ever created: a client cannot coin a MedDRA term by writing one in a form.
//
// The external lookup does not filter by isActive, for the same reason
// diagnosticTermResolution.service.ts:37-38 does not: a retired term is still referenceable, and
// resolving away from it would silently undo an administrator's decision.
//
// Whatever the branch, the master rules over the name and the divergence is preserved: historyRaw
// holds what the notifier wrote and only when it differs from what the catalog says. When it comes
// back null the notifier wrote exactly the name of the master
const resolveMedicalHistoryTerm = async (
    historyCode: string | null | undefined,
    historyName: string,
    source: TermSource | null | undefined,
    op: string,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<ResolvedMedicalHistoryTerm> => {
    const rawName = historyName.trim();
    const trimmedCode = normalizeText(historyCode);

    if( !trimmedCode ) {
        return { diagnosticTermId: null, historyRaw: rawName };
    }

    // Same normalization as ESAVI-DIAGTERM-001, 006 and 007, or neither branch would find what the
    // catalog saved. It is applied to the code and never to the name: the toConstantCase belongs to
    // the resolver's contract, and the name is the notifier's text
    const code = toConstantCase(trimmedCode);
    let term: DiagnosticTerm | null;

    if( !source || source === LOCAL_SOURCE ) {
        term = await resolveDiagnosticTermService(
            { code, name: rawName, operationCode: `ESAVI-MEDHIST-${ op }` },
            authUser,
            lang,
            transaction
        );
    } else {
        term = await DiagnosticTerm.findOne({
            where: { source, code },
            transaction
        });
        if( !term ) {
            throw new AppError(
                getMessage('notificationMedicalHistory.diagnosticTermNotFound', lang, { code, source }),
                404,
                `MEDHIST_${ op }_DIAGTERM_NOT_FOUND`
            );
        }
    }

    return {
        diagnosticTermId: term.diagnosticTermId,
        historyRaw: term.name === rawName ? null : rawName
    };
}

// The duplicate guard of 001 and 004: diagnosticTermId may not repeat among the ACTIVE antecedents
// of the same notification. Recording the same antecedent twice adds no information and does
// distort any count.
//
// No UNIQUE and no index backs it — it is a business rule of the service — and that is precisely
// why it only looks at active rows: an invented rule must not be stricter than the ones the database
// imposes, and here the database imposes none. Deactivating an antecedent and loading it again is
// the natural correction path, and blocking it would force a SUPERADMIN 005B to undo a USER's
// capture mistake.
//
// It only runs when the term has a value. Two free text antecedents are distinct records by
// definition: there is no identity to compare, and comparing null against null would turn the second
// free text into a 409 for no reason.
//
// It runs AFTER the resolution, never before: what is compared is the resolved term and not the code
// that arrived, because two different codes can resolve to the same term and comparing codes would
// let through the very duplicate the rule exists to prevent
const assertNoDuplicateMedicalHistory = async (
    notificationId: string,
    diagnosticTermId: string | null,
    op: string,
    lang: string,
    transaction: Transaction,
    excludedMedicalHistoryId?: string
) => {
    if( !diagnosticTermId ) return;

    const duplicate = await NotificationMedicalHistory.findOne({
        where: {
            notificationId,
            diagnosticTermId,
            isActive: true,
            ...( excludedMedicalHistoryId ? { medicalHistoryId: { [Op.ne]: excludedMedicalHistoryId } } : {} )
        },
        attributes: ['medicalHistoryId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('notificationMedicalHistory.alreadyExists', lang),
            409,
            `MEDHIST_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so an antecedent hanging from a retired notification simply does not come back
const findMedicalHistoryWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationMedicalHistory.findOne({
        where: includeInactive ? { medicalHistoryId: id } : { medicalHistoryId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...NOTIFICATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            DIAGNOSTIC_TERM_INCLUDE
        ]
    });
}

// Create Notification Medical History Service
// Code: ESAVI-MEDHIST-001
// Everything inside a single transaction, because the resolution against the clinical master may
// write in diagnosticTerm
const createNotificationMedicalHistoryService = async (
    data: CreateNotificationMedicalHistoryInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        // Not relaxed by canViewInactive for anybody: a retired notification takes no new
        // antecedents, whoever asks. It is the criterion of F31 and F33 for their 001
        await findValidNotification(data.notificationId, '001', lang);

        const resolved = await resolveMedicalHistoryTerm(
            data.historyCode,
            data.historyName,
            data.source,
            '001',
            authUser,
            lang,
            transaction
        );

        // After the resolution and never before: what is compared is the resolved term, not the code
        // that arrived. With no term nothing is checked
        await assertNoDuplicateMedicalHistory(
            data.notificationId,
            resolved.diagnosticTermId,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-MEDHIST-001',
            detail: 'Notification medical history created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
        // what lets TRG_notificationMedicalHistory_setSortOrder assign it, under the advisory lock
        // that keeps two concurrent inserts from colliding. Sending an explicit 0 would work by
        // accident, not by contract
        const created = await NotificationMedicalHistory.create({
            notificationId: data.notificationId,
            diagnosticTermId: resolved.diagnosticTermId,
            historyRaw: resolved.historyRaw,
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.medicalHistoryId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved master term and the sortOrder the trigger
    // assigned, which the create instance does not know
    const medicalHistory = await findMedicalHistoryWithRelations(createdId, true);
    return medicalHistory ? toNotificationMedicalHistoryResponse(medicalHistory) : null;
}

// Get Active Notification Medical Histories By Notification Service
// Code: ESAVI-MEDHIST-002A
// The listing is entered by the foreign key and never by /: an antecedent does not exist without its
// notification, and a global listing has no reader.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// diagnosticTermId or text — those are out of the scope of this spec
const getNotificationMedicalHistoriesByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002A', lang, canViewInactive);

    const medicalHistories = await NotificationMedicalHistory.findAndCountAll({
        where: { notificationId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: medicalHistories.count,
        rows: medicalHistories.rows.map(toNotificationMedicalHistoryResponse)
    };
}

// Get All Notification Medical Histories By Notification Service - For Admin
// Code: ESAVI-MEDHIST-002B
// The same listing as 002A without the isActive filter: it is the only door to an antecedent that
// was retired, and therefore the entry point of whoever is going to reactivate or purge it. It is
// also where the 006 sends anybody who needs to see inactive rows, since no admin variant of that
// operation is declared.
//
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed. Those are exactly the rows IX_notificationMedicalHistory_notification exists for: the
// partial unique index leaves them out.
//
// The parent guard still applies: an ADMIN sees inactive antecedents, not the antecedents of an
// inactive notification
const getAllNotificationMedicalHistoriesByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002B', lang, canViewInactive);

    const medicalHistories = await NotificationMedicalHistory.findAndCountAll({
        where: { notificationId },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: medicalHistories.count,
        rows: medicalHistories.rows.map(toNotificationMedicalHistoryResponse)
    };
}

export {
    createNotificationMedicalHistoryService,
    getNotificationMedicalHistoriesByNotificationService,
    getAllNotificationMedicalHistoriesByNotificationService
};
