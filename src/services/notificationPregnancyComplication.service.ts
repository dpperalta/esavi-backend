import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, DiagnosticTerm, Notification, NotificationPregnancy, NotificationPregnancyComplication } from '../models';
import { AppError, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { AppDetails, AuthUser, CreateNotificationPregnancyComplicationInput } from '../types';
import { TermSource } from '../constants/enums.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The source that admits implicit creation, and the only one the resolver of F15 ever writes: a
// client cannot coin a MedDRA or WHODrug term by typing one into a form
const LOCAL_SOURCE: TermSource = 'LOCAL';

// Code of the catalogType that groups the pregnancy complication types. Without this check any
// active catalogItem of the system would enter as a complication type. The three items the domain
// handles today — congenital anomalies, fetal or neonatal complications, complications of labour —
// are data of a particular installation and are deliberately not wired anywhere: what is validated
// is the membership of the catalogType, never the content.
// catalogType codes are stored in camelCase — catalogType.service.ts:12
const PREGNANCY_COMPLICATION_TYPE_CATALOG_CODE = 'pregnancyComplicationType';

// The columns the INSERT of ESAVI-PREGCOMP-001 writes, listed one by one so sortOrder stays out of
// it. Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own
// notNull validation over every attribute of the create before reaching Postgres, so an unlisted
// sortOrder would be rejected in the application and
// TRG_notificationPregnancyComplication_setSortOrder would never get to assign it. Passing the
// field list is what makes the column absent from the statement. complicationId is out for the same
// reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<NotificationPregnancyComplication>)[] = [
    'pregnancyId',
    'diagnosticTermId',
    'complicationTypeItemId',
    'complicationRawName',
    'notes',
    'isActive',
    'appDetails'
];

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails
// is trigger bookkeeping and never leaves the service, and the jsonb column this spec left out of
// scope is not named anywhere in this file — an explicit list is what keeps both out without having
// to mention them
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<NotificationPregnancyComplication>)[] = [
    'complicationId',
    'pregnancyId',
    'diagnosticTermId',
    'complicationTypeItemId',
    'complicationRawName',
    'sortOrder',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent chain, read on every operation to implement the inherited visibility. Two hops, as in
// notificationDiluent, but with a one to one first hop: UQ_notificationPregnancy_notification allows
// a single pregnancy per notification, so the fan out only opens at the second level. A perfectly
// active complication is invisible if its pregnancy was withdrawn, and also if the whole
// notification was.
//
// Neither the pregnancy nor the notification ever reaches the response: whoever needs them enters
// through ESAVI-NOTIFPRG-003 and ESAVI-NOTIFCN-003
const PREGNANCY_INCLUDE = {
    model: NotificationPregnancy,
    as: 'pregnancy',
    attributes: ['pregnancyId', 'isActive'],
    include: [{
        model: Notification,
        as: 'notification',
        attributes: ['notificationId', 'isActive']
    }]
};

// The resolved master term, with six fields. The jsonb column of the master stays out: it carries
// the internal markers of the implicit resolution — autoCreated, reviewStatus — which are
// governance of the catalog and not data of the notification. It is the decision of F16, literal.
//
// The include does not filter by isActive, deliberately: a term retired after the record was written
// still says what the complication was coded as
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// The complication type, narrowed to four fields. It always exists: the foreign key is mandatory on
// creation and the 004 does not let it be cleared
const COMPLICATION_TYPE_INCLUDE = {
    model: CatalogItem,
    as: 'complicationType',
    attributes: ['catalogItemId', 'code', 'name', 'isActive']
};

// The parent chain is dropped here after having done its job in the query, and the master term comes
// back as an explicit null when the complication was notified without a code, so a client does not
// have to tell "empty" from "absent".
//
// The name the client displays is complicationRawName ?? diagnosticTerm.name. There is no third
// field resolving it, and that is the simplification the DDL imposes: when complicationRawName is
// null the notifier wrote exactly what the master says
const toNotificationPregnancyComplicationResponse = (complication: NotificationPregnancyComplication) => {
    const plain = complication.toJSON() as Record<string, unknown>;
    delete plain.pregnancy;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;

    return plain;
}

// The pregnancy must exist and be active, and so must its notification: a retired pregnancy does not
// take a new complication, and neither does one hanging from a retired header. The two levels are
// checked in the same query with the nested include, which is why this is a single read and not two.
//
// The three reasons share code and message: telling them apart is of no use to the notifier, and
// distinguishing them would confirm to a USER that a pregnancy exists under a notification it is not
// allowed to see
const findValidPregnancy = async (pregnancyId: string, op: string, lang: string) => {
    const pregnancy = await NotificationPregnancy.findOne({
        where: { pregnancyId, isActive: true },
        attributes: ['pregnancyId'],
        include: [{
            model: Notification,
            as: 'notification',
            attributes: ['notificationId'],
            required: true,
            where: { isActive: true }
        }]
    });
    if( !pregnancy ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.pregnancyNotFound', lang),
            404,
            `PREGCOMP_${ op }_PREGNANCY_NOT_FOUND`
        );
    }
    return pregnancy;
}

// The same check as findValidPregnancy, relaxed by canViewInactive: the inherited visibility
// applied to the listings, where the parent is not the target of the write but the gate to the
// collection. A retired pregnancy — or one whose notification was retired — answers 404 for USER
// and ADMIN, and comes back for whoever may see inactive rows, today SUPERADMIN.
//
// The two levels are checked here too. Settling for the pregnancy alone would be cheaper by one
// join and would leave visible the complications of a notification that was withdrawn whole,
// breaking the transitivity of the rule exactly where the graph gets deep.
//
// A retired pregnancy answers 404 instead of an empty page, because an empty page would say "this
// pregnancy has no complications" to somebody who is simply not allowed to see them
const assertPregnancyIsVisible = async (
    pregnancyId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const pregnancy = await NotificationPregnancy.findOne({
        where: canViewInactive ? { pregnancyId } : { pregnancyId, isActive: true },
        attributes: ['pregnancyId'],
        include: [{
            model: Notification,
            as: 'notification',
            attributes: ['notificationId'],
            required: true,
            where: canViewInactive ? {} : { isActive: true }
        }]
    });
    if( !pregnancy ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.pregnancyNotFound', lang),
            404,
            `PREGCOMP_${ op }_PREGNANCY_NOT_FOUND`
        );
    }
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. Neither goes through toTitleCase or toConstantCase: complicationName and notes are
// the copy of what the notifier wrote and their only value is reproducing it. The one value that
// does get constant cased is the code, and only inside the resolution — where it is the key of the
// master lookup and never a column of this table.
//
// This is the eighth copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending, because doing it here would drag seven foreign services into a CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// The item must exist, be active and belong to the pregnancy complication type catalog: any other
// catalogItem would be a valid UUID pointing at a meaningless type. It is the double hop
// assertVaccinationSiteIsValid established, literal. An unseeded catalog makes every
// complicationTypeItemId fall here, which is the deployment precondition the spec declares.
//
// Three causes — it does not exist, it is inactive, it does not belong to the catalog — and a single
// error, because none of the three is actionable in a different way
const assertComplicationTypeIsValid = async (complicationTypeItemId: string, op: string, lang: string) => {
    const complicationType = await CatalogItem.findOne({
        where: { catalogItemId: complicationTypeItemId, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: PREGNANCY_COMPLICATION_TYPE_CATALOG_CODE },
            attributes: []
        }]
    });
    if( !complicationType ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.complicationTypeNotFound', lang),
            404,
            `PREGCOMP_${ op }_COMPLICATION_TYPE_NOT_FOUND`
        );
    }
}

// What the resolution against the clinical master leaves behind: two derived values and not the
// three of F16. This table has a single text column, so there is nowhere to denormalize the
// canonical name or the code — both are read from diagnosticTerm through the include, and that is
// the simplification the DDL imposes
interface ResolvedComplicationTerm {
    diagnosticTermId: string | null;
    complicationRawName: string | null;
}

// The resolution of ESAVI-PREGCOMP-001 and 004, in three branches.
//
// Without a code there is no term: the name is the free text of the notifier and there is nothing
// to diverge from, so complicationRawName keeps it as it is. With a code and LOCAL — or no source
// at all — the resolver of F15 answers, creating the term when it does not exist yet, which is the
// whole point of the implicit resolution. With a code and an external source the pair
// (source, code) is looked up and nothing is ever created: a client cannot coin a MedDRA term by
// writing one in a form.
//
// The external lookup does not filter by isActive, for the same reason
// diagnosticTermResolution.service.ts:37-38 does not: a retired term is still referenceable, and
// resolving away from it would silently undo an administrator's decision.
//
// Whatever the branch, the master rules over the name and the divergence is preserved:
// complicationRawName holds what the notifier wrote and only when it differs from what the catalog
// says. When it comes back null the notifier wrote exactly the name of the master
const resolveComplicationTerm = async (
    complicationCode: string | null | undefined,
    complicationName: string,
    source: TermSource | null | undefined,
    op: string,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<ResolvedComplicationTerm> => {
    const rawName = complicationName.trim();
    const trimmedCode = normalizeText(complicationCode);

    if( !trimmedCode ) {
        return { diagnosticTermId: null, complicationRawName: rawName };
    }

    // Same normalization as ESAVI-DIAGTERM-001, 006 and 007, or neither branch would find what the
    // catalog saved. It is applied to the code and never to the name: the toConstantCase belongs to
    // the resolver's contract, and the name is the notifier's text
    const code = toConstantCase(trimmedCode);
    let term: DiagnosticTerm | null;

    if( !source || source === LOCAL_SOURCE ) {
        term = await resolveDiagnosticTermService(
            { code, name: rawName, operationCode: `ESAVI-PREGCOMP-${ op }` },
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
                getMessage('notificationPregnancyComplication.diagnosticTermNotFound', lang, { code, source }),
                404,
                `PREGCOMP_${ op }_DIAGTERM_NOT_FOUND`
            );
        }
    }

    return {
        diagnosticTermId: term.diagnosticTermId,
        complicationRawName: term.name === rawName ? null : rawName
    };
}

// The duplicate guard of 001 and 004: the pair (diagnosticTermId, complicationTypeItemId) may not
// repeat among the ACTIVE complications of the same pregnancy. Recording the same complication
// twice with the same typing adds no information and does distort any count.
//
// No UNIQUE and no index backs it — it is a business rule of the service — and that is precisely
// why it only looks at active rows. The 001 of F25 answers 409 over an INACTIVE row because there
// a real constraint (esaviapp.sql:902) was going to reject the insert anyway, and saying 201 would
// have been lying to the client about what the database was about to do. Here there is no such
// constraint, and an invented rule must not be stricter than the ones the database imposes:
// deactivating a complication and loading it again is the natural correction path, and blocking it
// would force a SUPERADMIN 005B to undo a USER's capture mistake.
//
// It only runs when the term has a value. Two free text complications of the same type are
// distinct records by definition: there is no identity to compare, and comparing null against null
// would turn the second free text into a 409 for no reason.
//
// It runs AFTER the resolution, never before: what is compared is the resolved term and not the
// code that arrived, because two different codes can resolve to the same term and comparing codes
// would let through the very duplicate the rule exists to prevent
const assertNoDuplicateComplication = async (
    pregnancyId: string,
    diagnosticTermId: string | null,
    complicationTypeItemId: string | null | undefined,
    op: string,
    lang: string,
    transaction: Transaction,
    excludedComplicationId?: string
) => {
    if( !diagnosticTermId ) return;

    const duplicate = await NotificationPregnancyComplication.findOne({
        where: {
            pregnancyId,
            diagnosticTermId,
            complicationTypeItemId: complicationTypeItemId ?? null,
            isActive: true,
            ...( excludedComplicationId ? { complicationId: { [Op.ne]: excludedComplicationId } } : {} )
        },
        attributes: ['complicationId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.alreadyExists', lang),
            409,
            `PREGCOMP_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true and the isActive filter over both levels it is what implements the
// inherited visibility, so a complication hanging from a retired pregnancy — or from a pregnancy
// whose notification was retired — simply does not come back
const findComplicationWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await NotificationPregnancyComplication.findOne({
        where: includeInactive ? { complicationId: id } : { complicationId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...PREGNANCY_INCLUDE,
                required: true,
                where: includeInactive ? {} : { isActive: true },
                include: [{
                    ...PREGNANCY_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            DIAGNOSTIC_TERM_INCLUDE,
            COMPLICATION_TYPE_INCLUDE
        ]
    });
}

// Create Notification Pregnancy Complication Service
// Code: ESAVI-PREGCOMP-001
// Everything inside a single transaction, because the resolution against the clinical master may
// write in diagnosticTerm
const createNotificationPregnancyComplicationService = async (
    data: CreateNotificationPregnancyComplicationInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        await findValidPregnancy(data.pregnancyId, '001', lang);

        await assertComplicationTypeIsValid(data.complicationTypeItemId, '001', lang);

        const resolved = await resolveComplicationTerm(
            data.complicationCode,
            data.complicationName,
            data.source,
            '001',
            authUser,
            lang,
            transaction
        );

        // After the resolution and never before: what is compared is the resolved term, not the
        // code that arrived. With no term nothing is checked
        await assertNoDuplicateComplication(
            data.pregnancyId,
            resolved.diagnosticTermId,
            data.complicationTypeItemId,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-PREGCOMP-001',
            detail: 'Notification pregnancy complication created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
        // what lets TRG_notificationPregnancyComplication_setSortOrder assign it, under the advisory
        // lock that keeps two concurrent inserts from colliding. Sending an explicit 0 would work by
        // accident, not by contract
        const created = await NotificationPregnancyComplication.create({
            pregnancyId: data.pregnancyId,
            diagnosticTermId: resolved.diagnosticTermId,
            complicationTypeItemId: data.complicationTypeItemId,
            complicationRawName: resolved.complicationRawName,
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.complicationId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved master term, the complication type and the
    // sortOrder the trigger assigned, which the create instance does not know
    const complication = await findComplicationWithRelations(createdId, true);
    return complication ? toNotificationPregnancyComplicationResponse(complication) : null;
}

// Get Active Notification Pregnancy Complications By Pregnancy Service
// Code: ESAVI-PREGCOMP-002A
// The listing is entered by the foreign key and never by /: a notified complication does not exist
// without its pregnancy, and a global listing has no reader. It is not entered by the notification
// or by the case either — those would add a hop the client has already walked, since whoever
// reaches the complications got the pregnancyId from ESAVI-NOTIFPRG-006.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// complicationTypeItemId, diagnosticTermId or text — those are out of the scope of this spec
const getNotificationPregnancyComplicationsByPregnancyService = async (
    pregnancyId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertPregnancyIsVisible(pregnancyId, '002A', lang, canViewInactive);

    const complications = await NotificationPregnancyComplication.findAndCountAll({
        where: { pregnancyId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE, COMPLICATION_TYPE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: complications.count,
        rows: complications.rows.map(toNotificationPregnancyComplicationResponse)
    };
}

// Get All Notification Pregnancy Complications By Pregnancy Service - For Admin
// Code: ESAVI-PREGCOMP-002B
// The same listing as 002A without the isActive filter: it is the only door to a complication that
// was retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column
// and no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed. Those are exactly the rows IX_notificationPregnancyComplication_pregnancy exists for: the
// partial unique index of esaviapp.sql:1346-1347 leaves them out.
//
// The parent guard still applies: an ADMIN sees inactive complications, not the complications of an
// inactive pregnancy
const getAllNotificationPregnancyComplicationsByPregnancyService = async (
    pregnancyId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await assertPregnancyIsVisible(pregnancyId, '002B', lang, canViewInactive);

    const complications = await NotificationPregnancyComplication.findAndCountAll({
        where: { pregnancyId },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE, COMPLICATION_TYPE_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: complications.count,
        rows: complications.rows.map(toNotificationPregnancyComplicationResponse)
    };
}

// Get Notification Pregnancy Complication By ID Service
// Code: ESAVI-PREGCOMP-003
// Three filters, and two of them are the inherited visibility in chain: the complication must exist
// and be active, its pregnancy must be active, and the notification that pregnancy hangs from must
// be active too — unless canViewInactive says otherwise, today SUPERADMIN.
//
// The three conditions are evaluated the same way, with no priority among them: it is enough that
// one fails, so there is nothing to decide when two of them fail at once. The three failures answer
// the same 404 without distinguishing, because telling them apart would confirm to a USER that a
// complication exists under a pregnancy it is not allowed to see
const getNotificationPregnancyComplicationByIdService = async (
    id: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const complication = await findComplicationWithRelations(id, canViewInactive);
    if( !complication ) {
        throw new AppError(
            getMessage('notificationPregnancyComplication.notFound', lang),
            404,
            'PREGCOMP_003_NOT_FOUND'
        );
    }
    return toNotificationPregnancyComplicationResponse(complication);
}

export {
    createNotificationPregnancyComplicationService,
    getAllNotificationPregnancyComplicationsByPregnancyService,
    getNotificationPregnancyComplicationByIdService,
    getNotificationPregnancyComplicationsByPregnancyService
};
