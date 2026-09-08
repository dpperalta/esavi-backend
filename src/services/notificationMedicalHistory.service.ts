import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiagnosticTerm, EsaviCase, Notification, NotificationMedicalHistory } from '../models';
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { setEntityActiveStatusService } from './common/entityActivation.service';
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

// The read ESAVI-MEDHIST-004 works from. Two differences with the one above, and both are
// deliberate. It does not narrow the attributes: buildDifferentialUpdate compares the whole stored
// row, and an instance read with a narrowed `attributes` reads back undefined for what it left out,
// so every comparison would count as a change. And it keeps the diagnosticTerm include, because the
// update needs the master's name to compute the effective name and its code and source to decide
// whether the resolution has to run again.
//
// The parent include stays, so the inherited visibility is checked in the same query the update
// instance comes from
const findMedicalHistoryRow = async (id: string, includeInactive: boolean = false, transaction?: Transaction) => {
    return await NotificationMedicalHistory.findOne({
        where: includeInactive ? { medicalHistoryId: id } : { medicalHistoryId: id, isActive: true },
        include: [
            {
                ...NOTIFICATION_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true }
            },
            DIAGNOSTIC_TERM_INCLUDE
        ],
        transaction
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

// Get Notification Medical Histories By Case ID Service
// Code: ESAVI-MEDHIST-006
// The real query of the domain: the client holds the caseId, not the notificationId. The chain
// case -> notification is one to one, but N antecedents hang from the notification, so like the 006
// of notificationEvent, notificationMedication and notificationVaccine this one returns
// { count, rows } and not a single record.
//
// The two 404 are deliberately distinct — the client enters through a caseId and needs to know which
// link of the chain broke — and from there it is the 002A: active antecedents only, ordered by
// sortOrder. No admin variant is declared: the rows carry the notificationId, which is the entry to
// the 002B for whoever needs to see the retired ones, so not even a SUPERADMIN gets inactive rows
// back from here
const getNotificationMedicalHistoriesByCaseIdService = async (
    caseId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const esaviCase = await EsaviCase.findOne({
        where: { caseId, isActive: true },
        attributes: ['caseId']
    });
    if( !esaviCase ) {
        throw new AppError(getMessage('notificationMedicalHistory.caseNotFound', lang), 404, 'MEDHIST_006_CASE_NOT_FOUND');
    }

    const where = canViewInactive ? { caseId } : { caseId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationMedicalHistory.notificationNotFound', lang),
            404,
            'MEDHIST_006_NOTIFICATION_NOT_FOUND'
        );
    }

    const medicalHistories = await NotificationMedicalHistory.findAndCountAll({
        where: { notificationId: notification.notificationId, isActive: true },
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

// Get Notification Medical History By ID Service
// Code: ESAVI-MEDHIST-003
// The inherited visibility of one hop, applied whole: the antecedent comes back only if it is active
// and its notification is too. The two conditions are evaluated the same way and neither has
// priority — it is enough that one fails — and both are relaxed together by canViewInactive, so
// today a SUPERADMIN reads what a USER and an ADMIN get a 404 for.
//
// This is not the access by notification: whoever wants the collection enters through the 002A
const getNotificationMedicalHistoryByIdService = async (
    id: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const medicalHistory = await findMedicalHistoryWithRelations(id, canViewInactive);
    if( !medicalHistory ) {
        throw new AppError(
            getMessage('notificationMedicalHistory.notFound', lang),
            404,
            'MEDHIST_003_NOT_FOUND'
        );
    }

    return toNotificationMedicalHistoryResponse(medicalHistory);
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

// Update Notification Medical History Service
// Code: ESAVI-MEDHIST-004
// Inside a transaction, for the same reason as the 001: the resolution against the clinical master
// may write in diagnosticTerm.
//
// notificationId and sortOrder are ignored whether or not they arrive in the body, and neither
// answers 400: the first one is immutable — moving an antecedent to another notification is not
// updating it, it is creating a different one — and the second one is governed by the database.
// Answering 400 for a field a client resends whole from a GET is hostile for no reason
const updateNotificationMedicalHistoryService = async (
    id: string,
    data: Partial<CreateNotificationMedicalHistoryInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const transaction = await sequelize.transaction();

    try {
        const medicalHistory = await findMedicalHistoryRow(id, canViewInactive, transaction);
        if( !medicalHistory ) {
            throw new AppError(
                getMessage('notificationMedicalHistory.notFound', lang),
                404,
                'MEDHIST_004_NOT_FOUND'
            );
        }

        // The whole row, never narrowed: that is the precondition of buildDifferentialUpdate
        const stored = medicalHistory.get({ plain: true }) as Record<string, unknown>;
        const storedTerm = stored.diagnosticTerm as { code: string | null, name: string, source: TermSource } | null;

        // What the GET shows as the name of the antecedent, and the only thing an incoming
        // historyName can be compared against: this table has a single text column, so
        // storedEffectiveName is unambiguous where F16 had to choose between two.
        //
        // The GET carries no historyName of its own — it exposes historyRaw and diagnosticTerm.name
        // and lets the client compose them — so a PUT resending the whole response arrives with the
        // key ABSENT and falls through to the stored effective name. That is what keeps the trap F16
        // paid for closed: the text the notifier wrote is never rewritten by an echo of the GET
        const storedEffectiveName = ( stored.historyRaw as string | null ) ?? storedTerm?.name ?? null;
        const incomingName = data.historyName !== undefined
            ? normalizeText(data.historyName)
            : storedEffectiveName;

        // The resolution is re-fired by the change of value, never by the presence of the key
        // (SPEC F12). The stored code and source are the ones of the term that was resolved, read
        // from the include: a PUT resending them consults nothing and writes nothing
        const storedCode = storedTerm?.code ?? null;
        const storedSource = storedTerm?.source ?? null;

        const codeArrived = data.historyCode !== undefined;
        const trimmedIncomingCode = normalizeText(data.historyCode);
        const incomingCode = codeArrived
            ? ( trimmedIncomingCode ? toConstantCase(trimmedIncomingCode) : null )
            : storedCode;
        const sourceArrived = data.source !== undefined && data.source !== null;
        const incomingSource = sourceArrived ? ( data.source as TermSource ) : storedSource;

        const mustResolveAgain = incomingCode !== storedCode
            || ( sourceArrived && incomingSource !== storedSource )
            || incomingName !== storedEffectiveName;

        const resolved: ResolvedMedicalHistoryTerm = mustResolveAgain
            ? await resolveMedicalHistoryTerm(
                incomingCode,
                incomingName ?? '',
                incomingSource,
                '004',
                authUser,
                lang,
                transaction
            )
            : {
                diagnosticTermId: stored.diagnosticTermId as string | null,
                historyRaw: stored.historyRaw as string | null
            };

        // The guard runs over the RESULTING term and excludes the row itself, so re-sending its own
        // term is a 200 that writes nothing while landing on another live sister is a 409
        await assertNoDuplicateMedicalHistory(
            stored.notificationId as string,
            resolved.diagnosticTermId,
            '004',
            lang,
            transaction,
            id
        );

        // notificationId, sortOrder and isActive are deliberately absent: the first two are immutable
        // and the state moves through 005A and 005B. The two derived fields enter ALWAYS — with the
        // resolved value or with the stored one — so a resolution that did not change anything
        // produces no diff and therefore no write
        const candidates: Record<string, unknown> = {
            diagnosticTermId: resolved.diagnosticTermId,
            historyRaw: resolved.historyRaw,
            // Trimmed and never title cased, or a PUT resending the GET would rewrite what the
            // notifier wrote
            notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
        };

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
        // sysDetails.version bump that TRG_notificationMedicalHistory_setSysDetails fires on every
        // write
        const objectToUpdate = buildDifferentialUpdate(stored, candidates);
        if( Object.keys(objectToUpdate).length > 0 ) {
            // Written by hand so the service does not depend on a trigger for a column it owns: the
            // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
            objectToUpdate.updatedAt = new Date();

            // The history is extended, never overwritten
            const currentAppDetails = Array.isArray(medicalHistory.appDetails)
                ? medicalHistory.appDetails
                : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-MEDHIST-004',
                detail: 'Notification medical history updated by service'
            };
            await medicalHistory.update({
                ...objectToUpdate,
                appDetails: [
                    ...currentAppDetails,
                    newEntry
                ]
            }, { transaction });
        }

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    const updated = await findMedicalHistoryWithRelations(id, true);
    return updated ? toNotificationMedicalHistoryResponse(updated) : null;
}

// The one piece of ESAVI-MEDHIST-005B that is not a clean delegation, and the reason this entity
// cannot hand its activation to setEntityActiveStatusService and be done with it. It is the finding
// of F16, whole, and the eighth entity to inherit it after F21, F22, F24, F27, F31 and F33.
//
// UQ_notificationMedicalHistory_parent_sortOrder is a partial unique index over
// (notificationId, sortOrder) WHERE deletedAt IS NULL AND sortOrder IS NOT NULL. A 005A seals
// deletedAt, so the number leaves both the index and the MAX the insert trigger computes, and a
// later create legitimately reuses it. The moment setEntityActiveStatusService:34 clears deletedAt,
// the reactivated row re-enters the index carrying a number another live row already holds, and the
// UPDATE dies with a constraint violation — a 500 for an operation that should answer 200.
//
// The fix is to move the number before touching deletedAt: while deletedAt is still sealed the row
// is outside the partial index, so this write is free. Inverting the two steps makes the index fail
// inside the helper's own UPDATE — the constraint is not deferrable and there would be no way to fix
// it afterwards.
//
// This is a write with an intention of its own over a field the client neither sent nor can send, so
// it does not go through buildDifferentialUpdate: it does not come from comparing an incoming value
// against the stored one, but from a constraint of the database.
//
// A missing row is left alone: the helper right after raises the 404. An already active row finds no
// collision either — the index guarantees no other live row shares its number — so nothing is
// written and the helper raises its 409 as usual
const reassignSortOrderOnCollision = async (id: string, transaction: Transaction) => {
    const medicalHistory = await NotificationMedicalHistory.findOne({
        where: { medicalHistoryId: id },
        paranoid: false,
        transaction
    });
    if( !medicalHistory || medicalHistory.deletedAt === null ) {
        return;
    }

    const collision = await NotificationMedicalHistory.findOne({
        where: {
            notificationId: medicalHistory.notificationId,
            sortOrder: medicalHistory.sortOrder as number,
            deletedAt: null,
            medicalHistoryId: { [Op.ne]: id }
        },
        attributes: ['medicalHistoryId'],
        paranoid: false,
        transaction
    });
    if( !collision ) {
        return;
    }

    // The same count TRG_notificationMedicalHistory_setSortOrder does on insert, so the reactivated
    // antecedent reappears at the end of the list
    const highest = await NotificationMedicalHistory.max<number, NotificationMedicalHistory>('sortOrder', {
        where: { notificationId: medicalHistory.notificationId, deletedAt: null },
        transaction
    });

    await medicalHistory.update(
        { sortOrder: ( Number(highest) || 0 ) + 1 },
        { transaction, fields: ['sortOrder'] }
    );
}

// Set Notification Medical History Activation Service
// Code: ESAVI-MEDHIST-005A / ESAVI-MEDHIST-005B
// One service for the two operations, as the rest of the repository does it. Neither is a
// differential update: they are state writes with an intent of their own, they record a fact even
// though no data column changes, and that is why they go through setEntityActiveStatusService and
// never through buildDifferentialUpdate.
//
// The 005A seals deletedAt, which frees the sortOrder from the partial unique index. That is correct
// and deliberate: the gap stays available for the next antecedent.
//
// The 005A is blocked by nothing. notificationMedicalHistory is a leaf of the graph: none of the 49
// tables references it, so there are no children to query and no state to drag. It does not check
// the state of the notification either — whoever retires an antecedent acts on the row's own state,
// which exists independently of its parent — and it never touches hasRelevantMedicalHistory, not
// even when the one being withdrawn was the last live antecedent of the notification
const setNotificationMedicalHistoryActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // Only on the way back: a 005A is what frees the number, so it never collides.
        // The reactivation revalidates nothing else — not the duplicate term, not the state of the
        // notification. Bringing a row back to life is undoing a deactivation, not rewriting it. The
        // consequence — a 005B can resurrect a diagnosticTermId that already exists live — is
        // assumed: the alternative leaves a SUPERADMIN with a row that can never come back and
        // nothing to do about it but purge it. The duplicate is visible, correctable with a 005A and
        // breaks nothing
        if( isActive ) {
            await reassignSortOrderOnCollision(id, transaction);
        }

        const medicalHistory = await setEntityActiveStatusService({
            model: NotificationMedicalHistory,
            where: { medicalHistoryId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('notificationMedicalHistory.notFound', lang),
            notFoundCode: `MEDHIST_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`notificationMedicalHistory.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `MEDHIST_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-MEDHIST-${ op }`,
                detail: `Notification medical history ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return medicalHistory;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNotificationMedicalHistoryService,
    getNotificationMedicalHistoriesByNotificationService,
    getAllNotificationMedicalHistoriesByNotificationService,
    getNotificationMedicalHistoryByIdService,
    getNotificationMedicalHistoriesByCaseIdService,
    updateNotificationMedicalHistoryService,
    setNotificationMedicalHistoryActivationService
};
