import { InferAttributes, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiagnosticTerm, Notification, NotificationEvent } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { AppDetails, AuthUser, CreateNotificationEventInput } from '../types';
import { TermSource } from '../constants/enums.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The source that admits implicit creation, and the only one the resolver of F15 ever writes: a
// client cannot claim a term belongs to a licensed dictionary
const LOCAL_SOURCE: TermSource = 'LOCAL';

// The columns the INSERT of ESAVI-NOTIFEVT-001 writes, listed one by one so sortOrder stays out
// of it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its
// own notNull validation over every attribute of the create before reaching Postgres, so an
// unlisted sortOrder would be rejected in the application and TRG_notificationEvent_setSortOrder
// would never get to assign it. Passing the field list is what makes the column absent from the
// statement. eventId is out for the same reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationEvent>)[] = [
    'notificationId',
    'diagnosticTermId',
    'esaviName',
    'esaviCode',
    'esaviRawName',
    'isMainEsavi',
    'startDate',
    'startTime',
    'isOtherEsavi',
    'otherDescription',
    'notes',
    'isActive',
    'appDetails'
];

// The header is read on every operation to implement the inherited visibility, and it is read with
// two attributes because that is all the check needs. It never reaches the response — whoever
// needs the header enters through ESAVI-NOTIFCN-003
const NOTIFICATION_INCLUDE = {
    model: Notification,
    as: 'notification',
    attributes: ['notificationId', 'isActive']
};

// The resolved term does travel in the response, with six fields. metadata stays out: autoCreated
// and reviewStatus are catalog governance, not data of the notification, and exposing them would
// invite a client to interpret them. appDetails and sysDetails stay out for the same reason they
// do everywhere else
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// sysDetails is trigger metadata and never leaves the service. The header is dropped here after
// having done its job in the query, and diagnosticTerm comes back as an explicit null when the
// event was never coded, so a client does not have to tell "empty" from "absent"
const toNotificationEventResponse = (notificationEvent: NotificationEvent) => {
    const plain = notificationEvent.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.notification;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;

    return plain;
}

// The read every operation shares to build its response. The header include is mandatory and not
// decorative: with required: true and the isActive filter it is what implements the inherited
// visibility, so an event hanging from a retired notification simply does not come back
const findNotificationEventWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationEvent.findOne({
        where: includeInactive ? { eventId: id } : { eventId: id, isActive: true },
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

// The notification must exist and be active: a retired header does not take a new event. No check
// by notificationType — an ESAVI is described the same way whether it is severe or not, which is
// the single guard that separates this entity from its two one to one siblings
const assertNotificationIsValid = async (notificationId: string, op: string, lang: string, transaction?: Transaction) => {
    const notification = await Notification.findOne({
        where: { notificationId, isActive: true },
        attributes: ['notificationId'],
        transaction
    });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationEvent.notificationNotFound', lang),
            404,
            `NOTIFEVT_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The same check as above, relaxed by canViewInactive: the inherited visibility applied to the
// listings, where the header is not the target of the write but the gate to the collection. A
// retired notification answers 404 for USER and ADMIN, and comes back for whoever may see
// inactive rows — today SUPERADMIN
const assertNotificationIsVisible = async (
    notificationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const where = canViewInactive ? { notificationId } : { notificationId, isActive: true };
    const notification = await Notification.findOne({ where, attributes: ['notificationId'] });
    if( !notification ) {
        throw new AppError(
            getMessage('notificationEvent.notificationNotFound', lang),
            404,
            `NOTIFEVT_${ op }_NOTIFICATION_NOT_FOUND`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The coherence rule of the "other" event, shared by 001 and 004. It lives here and not in the
// validator because on update it is evaluated over the resulting state — what is stored merged
// with what arrives — and the validator only sees the body. It still answers 400: the problem is
// the combination of fields in the body, which is malformed input however it is checked.
// An event declared as "other" is by definition one the clinical catalog does not name, so
// carrying a code or a resolved term at the same time is a contradiction, not a preference
const assertOtherEsaviRule = (
    isOtherEsavi: boolean | null | undefined,
    otherDescription: string | null | undefined,
    esaviCode: string | null | undefined,
    diagnosticTermId: string | null | undefined,
    op: string,
    lang: string
) => {
    const description = normalizeText(otherDescription);

    if( isOtherEsavi === true ) {
        if( !description ) {
            throw new AppError(
                getMessage('notificationEvent.otherDescriptionRequired', lang),
                400,
                `NOTIFEVT_${ op }_OTHER_DESCRIPTION_REQUIRED`
            );
        }
        if( normalizeText(esaviCode) || diagnosticTermId ) {
            throw new AppError(
                getMessage('notificationEvent.otherEsaviConflict', lang),
                400,
                `NOTIFEVT_${ op }_OTHER_ESAVI_CONFLICT`
            );
        }
        return;
    }

    if( description ) {
        throw new AppError(
            getMessage('notificationEvent.otherDescriptionNotAllowed', lang),
            400,
            `NOTIFEVT_${ op }_OTHER_DESCRIPTION_NOT_ALLOWED`
        );
    }
}

// What the resolution against the clinical master leaves behind: the three derived values the row
// stores. Never the source, which is input and not a column
interface ResolvedEsaviTerm {
    // Normalized here and stored normalized, so the update can compare an incoming code against
    // the stored one without normalizing the stored side every time
    esaviCode: string | null;
    diagnosticTermId: string | null;
    esaviName: string;
    esaviRawName: string | null;
}

// The resolution of ESAVI-NOTIFEVT-001 and 004, in three branches.
//
// Without a code there is no term: the name is the free text of the notifier and there is nothing
// to diverge from. With a code and LOCAL — or no source at all — the resolver of F15 answers,
// creating the term when it does not exist yet, which is the whole point of the implicit
// resolution. With a code and an external source the pair (source, code) is looked up and nothing
// is ever created: a client cannot coin a MedDRA term by writing one in a form.
//
// The external lookup does not filter by isActive, for the same reason
// diagnosticTermResolution.service.ts:37-38 does not: a retired term is still referenceable, and
// resolving away from it would silently undo an administrator's decision.
//
// Whatever the branch, the master rules over the name and the divergence is preserved: esaviName
// is what the catalog says, esaviRawName is what the notifier wrote and only when the two differ
const resolveEsaviTerm = async (
    esaviCode: string | null | undefined,
    esaviName: string,
    source: TermSource | undefined,
    op: string,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<ResolvedEsaviTerm> => {
    const rawName = esaviName.trim();
    const trimmedCode = normalizeText(esaviCode);

    if( !trimmedCode ) {
        return { esaviCode: null, diagnosticTermId: null, esaviName: rawName, esaviRawName: null };
    }

    // Same normalization as ESAVI-DIAGTERM-001, 006 and 007, or neither branch would find what
    // the catalog saved
    const code = toConstantCase(trimmedCode);
    let term: DiagnosticTerm | null;

    if( !source || source === LOCAL_SOURCE ) {
        term = await resolveDiagnosticTermService(
            { code, name: rawName, operationCode: `ESAVI-NOTIFEVT-${ op }` },
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
                getMessage('notificationEvent.diagnosticTermNotFound', lang, { code, source }),
                404,
                `NOTIFEVT_${ op }_DIAGTERM_NOT_FOUND`
            );
        }
    }

    return {
        esaviCode: code,
        diagnosticTermId: term.diagnosticTermId,
        esaviName: term.name,
        esaviRawName: term.name === rawName ? null : rawName
    };
}

// Create Notification Event Service
// Code: ESAVI-NOTIFEVT-001
// The transaction is its own and wraps the resolution: if the create of the event fails, the term
// just coined rolls back with it. That is the contract F15 wrote the resolver against — it takes
// the caller's transaction and never opens one of its own
const createNotificationEventService = async (
    data: CreateNotificationEventInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        await assertNotificationIsValid(data.notificationId, '001', lang, transaction);

        // On create the body is the whole resulting state, so the rule is evaluated over it
        // directly. diagnosticTermId is not passed: the client cannot send it, and the resolution
        // that would produce it has not run yet — running it first would coin a term for an event
        // that is about to be rejected
        assertOtherEsaviRule(data.isOtherEsavi, data.otherDescription, data.esaviCode, null, '001', lang);

        const resolved = await resolveEsaviTerm(
            data.esaviCode,
            data.esaviName,
            data.source,
            '001',
            authUser,
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-NOTIFEVT-001',
            detail: 'Notification event created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT
        // is what lets TRG_notificationEvent_setSortOrder assign it, under the advisory lock that
        // keeps two concurrent inserts from colliding. Sending an explicit 0 would work by
        // accident, not by contract
        const created = await NotificationEvent.create({
            notificationId: data.notificationId,
            diagnosticTermId: resolved.diagnosticTermId,
            esaviName: resolved.esaviName,
            esaviCode: resolved.esaviCode,
            esaviRawName: resolved.esaviRawName,
            isMainEsavi: data.isMainEsavi ?? false,
            startDate: data.startDate ?? null,
            startTime: data.startTime ?? null,
            isOtherEsavi: data.isOtherEsavi ?? false,
            otherDescription: normalizeText(data.otherDescription),
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.eventId;
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read outside the transaction so the response carries the resolved term and the sortOrder
    // the trigger assigned, which the create instance does not know
    const created = await findNotificationEventWithRelations(createdId, true);
    return created ? toNotificationEventResponse(created) : null;
}

// Get Active Notification Events By Notification Service
// Code: ESAVI-NOTIFEVT-002A
// The listing is entered by the foreign key and never by /: an event does not exist without its
// notification, and a global listing of events has no reader.
//
// The header guard is the inherited visibility applied to a collection: a retired notification
// answers 404 instead of an empty page, because an empty page would say "this notification has no
// events" to somebody who is simply not allowed to see them.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// isMainEsavi, diagnosticTermId, startDate or text — those are out of the scope of this spec
const getNotificationEventsByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002A', lang, canViewInactive);

    const notificationEvents = await NotificationEvent.findAndCountAll({
        where: { notificationId, isActive: true },
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: notificationEvents.count,
        rows: notificationEvents.rows.map(toNotificationEventResponse)
    };
}

// Get All Notification Events By Notification Service - For Admin
// Code: ESAVI-NOTIFEVT-002B
// The same listing as 002A without the isActive filter: it is the only door to an event that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a
// 005A sealed
const getAllNotificationEventsByNotificationService = async (
    notificationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertNotificationIsVisible(notificationId, '002B', lang, canViewInactive);

    const notificationEvents = await NotificationEvent.findAndCountAll({
        where: { notificationId },
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: notificationEvents.count,
        rows: notificationEvents.rows.map(toNotificationEventResponse)
    };
}

export {
    createNotificationEventService,
    getNotificationEventsByNotificationService,
    getAllNotificationEventsByNotificationService
};
