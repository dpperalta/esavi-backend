import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType, DiagnosticTerm, Notification, NotificationPregnancy, NotificationPregnancyComplication } from '../models';
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { setEntityActiveStatusService } from './common/entityActivation.service';
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

// The read ESAVI-PREGCOMP-004 works from. Two differences with the one above, and both are
// deliberate. It does not narrow the attributes: buildDifferentialUpdate compares the whole stored
// row, and an instance read with a narrowed `attributes` reads back undefined for what it left out,
// so every comparison would count as a change. And it keeps the diagnosticTerm include, because the
// update needs the master's name to compute the effective name and its code and source to decide
// whether the resolution has to run again.
//
// The parent chain stays, so the inherited visibility is checked in the same query the update
// instance comes from
const findComplicationRow = async (id: string, includeInactive: boolean = false, transaction?: Transaction) => {
    return await NotificationPregnancyComplication.findOne({
        where: includeInactive ? { complicationId: id } : { complicationId: id, isActive: true },
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
            DIAGNOSTIC_TERM_INCLUDE
        ],
        transaction
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

// Update Notification Pregnancy Complication Service
// Code: ESAVI-PREGCOMP-004
// Inside a transaction, for the same reason as the 001: the resolution against the clinical master
// may write in diagnosticTerm.
//
// pregnancyId and sortOrder are ignored whether or not they arrive in the body, and neither answers
// 400: the first one is immutable — moving a complication to another pregnancy is not updating it,
// it is creating a different one — and the second one is governed by the database
const updateNotificationPregnancyComplicationService = async (
    id: string,
    data: Partial<CreateNotificationPregnancyComplicationInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const transaction = await sequelize.transaction();

    try {
        const complication = await findComplicationRow(id, canViewInactive, transaction);
        if( !complication ) {
            throw new AppError(
                getMessage('notificationPregnancyComplication.notFound', lang),
                404,
                'PREGCOMP_004_NOT_FOUND'
            );
        }

        // The whole row, never narrowed: that is the precondition of buildDifferentialUpdate
        const stored = complication.get({ plain: true }) as Record<string, unknown>;
        const storedTerm = stored.diagnosticTerm as { code: string | null, name: string, source: TermSource } | null;

        // What the GET shows as the name of the complication, and the only thing an incoming
        // complicationName can be compared against: this table has a single text column, so
        // storedEffectiveName is unambiguous where F16 had to choose between esaviName and
        // esaviRawName
        const storedEffectiveName = ( stored.complicationRawName as string | null ) ?? storedTerm?.name ?? null;

        // The second condition is the trap F16 documented and paid for. Without it a PUT resending
        // the whole response of its GET would rewrite complicationRawName on every row with a
        // divergence, and the text the notifier wrote would disappear with nobody noticing. A
        // complicationName arriving EQUAL to what the GET displayed is not a rewrite, so it falls
        // through to the fallback exactly like an absent key
        const incomingName = data.complicationName !== undefined
                && normalizeText(data.complicationName) !== storedEffectiveName
            ? normalizeText(data.complicationName)
            : storedEffectiveName;

        // The resolution is re-fired by the change of value, never by the presence of the key
        // (SPEC F12). The stored code and source are the ones of the term that was resolved, read
        // from the include: a PUT resending them consults nothing and writes nothing
        const storedCode = storedTerm?.code ?? null;
        const storedSource = storedTerm?.source ?? null;

        const codeArrived = data.complicationCode !== undefined;
        const trimmedIncomingCode = normalizeText(data.complicationCode);
        const incomingCode = codeArrived
            ? ( trimmedIncomingCode ? toConstantCase(trimmedIncomingCode) : null )
            : storedCode;
        const sourceArrived = data.source !== undefined && data.source !== null;
        const incomingSource = sourceArrived ? ( data.source as TermSource ) : storedSource;

        const mustResolveAgain = incomingCode !== storedCode
            || ( sourceArrived && incomingSource !== storedSource )
            || incomingName !== storedEffectiveName;

        const resolved: ResolvedComplicationTerm = mustResolveAgain
            ? await resolveComplicationTerm(
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
                complicationRawName: stored.complicationRawName as string | null
            };

        // Before the diff and independently of it: a PUT carrying a retired type answers 404 even
        // when no other field changes. The key is not nullable — an explicit null is a 400 of the
        // validator — so only its presence is checked here
        if( data.complicationTypeItemId !== undefined ) {
            await assertComplicationTypeIsValid(data.complicationTypeItemId, '004', lang);
        }

        // The guard runs over the RESULTING pair and excludes the row itself, so re-sending its own
        // pair is a 200 that writes nothing while landing on another live sister is a 409
        const resultingTypeItemId = data.complicationTypeItemId !== undefined
            ? data.complicationTypeItemId
            : ( stored.complicationTypeItemId as string | null );
        await assertNoDuplicateComplication(
            stored.pregnancyId as string,
            resolved.diagnosticTermId,
            resultingTypeItemId,
            '004',
            lang,
            transaction,
            id
        );

        // pregnancyId, sortOrder and isActive are deliberately absent: the first two are immutable
        // and the state moves through 005A and 005B. The two derived fields enter ALWAYS — with the
        // resolved value or with the stored one — so a resolution that did not change anything
        // produces no diff and therefore no write
        const candidates: Record<string, unknown> = {
            diagnosticTermId: resolved.diagnosticTermId,
            complicationRawName: resolved.complicationRawName,
            complicationTypeItemId: data.complicationTypeItemId !== undefined
                ? data.complicationTypeItemId
                : undefined,
            // Trimmed and never title cased, or a PUT resending the GET would rewrite what the
            // notifier wrote
            notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
        };

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
        // sysDetails.version bump that TRG_notificationPregnancyComplication_setSysDetails fires on
        // every write
        const objectToUpdate = buildDifferentialUpdate(stored, candidates);
        if( Object.keys(objectToUpdate).length > 0 ) {
            // Written by hand so the service does not depend on a trigger for a column it owns: the
            // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
            objectToUpdate.updatedAt = new Date();

            // The history is extended, never overwritten
            const currentAppDetails = Array.isArray(complication.appDetails)
                ? complication.appDetails
                : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-PREGCOMP-004',
                detail: 'Notification pregnancy complication updated by service'
            };
            await complication.update({
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

    const updated = await findComplicationWithRelations(id, true);
    return updated ? toNotificationPregnancyComplicationResponse(updated) : null;
}

// The one piece of ESAVI-PREGCOMP-005B that is not a clean delegation, and the reason this entity
// cannot hand its activation to setEntityActiveStatusService and be done with it. It is the finding
// of F16, whole, and it is the exact difference with the parent of this table: F25 could declare
// the 005B of notificationPregnancy a clean delegation precisely because notificationPregnancy has
// no sortOrder. Copying that one by proximity, instead of F16's by structural likeness, is the most
// probable mistake of this spec.
//
// UQ_notificationPregnancyComplication_parent_sortOrder is a partial unique index over
// (pregnancyId, sortOrder) WHERE deletedAt IS NULL AND sortOrder IS NOT NULL
// (esaviapp.sql:1346-1348). A 005A seals deletedAt, so the number leaves both the index and the MAX
// the insert trigger computes, and a later create legitimately reuses it. The moment
// setEntityActiveStatusService:34 clears deletedAt, the reactivated row re-enters the index
// carrying a number another live row already holds, and the UPDATE dies with a constraint violation
// — a 500 for an operation that should answer 200.
//
// The fix is to move the number before touching deletedAt: while deletedAt is still sealed the row
// is outside the partial index, so this write is free. Inverting the two steps makes the index fail
// inside the helper's own UPDATE — the constraint is not deferrable and there would be no way to
// fix it afterwards.
//
// This is a write with an intention of its own over a field the client neither sent nor can send,
// so it does not go through buildDifferentialUpdate: it does not come from comparing an incoming
// value against the stored one, but from a constraint of the database.
//
// A missing row is left alone: the helper right after raises the 404. An already active row finds
// no collision either — the index guarantees no other live row shares its number — so nothing is
// written and the helper raises its 409 as usual
const reassignSortOrderOnCollision = async (id: string, transaction: Transaction) => {
    const complication = await NotificationPregnancyComplication.findOne({
        where: { complicationId: id },
        paranoid: false,
        transaction
    });
    if( !complication || complication.deletedAt === null ) {
        return;
    }

    const collision = await NotificationPregnancyComplication.findOne({
        where: {
            pregnancyId: complication.pregnancyId,
            sortOrder: complication.sortOrder as number,
            deletedAt: null,
            complicationId: { [Op.ne]: id }
        },
        attributes: ['complicationId'],
        paranoid: false,
        transaction
    });
    if( !collision ) {
        return;
    }

    // The same count TRG_notificationPregnancyComplication_setSortOrder does on insert, so the
    // reactivated complication reappears at the end of the list
    const highest = await NotificationPregnancyComplication.max<number, NotificationPregnancyComplication>('sortOrder', {
        where: { pregnancyId: complication.pregnancyId, deletedAt: null },
        transaction
    });

    await complication.update(
        { sortOrder: ( Number(highest) || 0 ) + 1 },
        { transaction, fields: ['sortOrder'] }
    );
}

// Set Notification Pregnancy Complication Activation Service
// Code: ESAVI-PREGCOMP-005A / ESAVI-PREGCOMP-005B
// One service for the two operations, as the rest of the repository does it. Neither is a
// differential update: they are state writes with an intent of their own, they record a fact even
// though no data column changes, and that is why they go through setEntityActiveStatusService and
// never through buildDifferentialUpdate.
//
// The 005A seals deletedAt, which frees the sortOrder from the partial unique index. That is
// correct and deliberate: the gap stays available for the next complication.
//
// The 005A is blocked by nothing. notificationPregnancyComplication is a leaf of the graph: there
// are no children to query and no state to drag, so deactivating a complication touches nothing
// else — least of all its parent, whose hasComplications stays client data
const setNotificationPregnancyComplicationActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // Only on the way back: a 005A is what frees the number, so it never collides.
        // The reactivation revalidates nothing else — not the duplicate pair, not the complication
        // type, not the state of the pregnancy or of the notification. Bringing a row back to life
        // is undoing a deactivation, not rewriting it, which is the criterion of F25 §6. The
        // consequence — a 005B can resurrect a pair (diagnosticTermId, complicationTypeItemId) that
        // already exists live — is assumed: the alternative leaves a SUPERADMIN with a row that can
        // never come back and nothing to do about it but purge it. The duplicate is visible,
        // correctable with a 005A and breaks nothing
        if( isActive ) {
            await reassignSortOrderOnCollision(id, transaction);
        }

        const complication = await setEntityActiveStatusService({
            model: NotificationPregnancyComplication,
            where: { complicationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('notificationPregnancyComplication.notFound', lang),
            notFoundCode: `PREGCOMP_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`notificationPregnancyComplication.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `PREGCOMP_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-PREGCOMP-${ op }`,
                detail: `Notification pregnancy complication ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return complication;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createNotificationPregnancyComplicationService,
    getAllNotificationPregnancyComplicationsByPregnancyService,
    getNotificationPregnancyComplicationByIdService,
    getNotificationPregnancyComplicationsByPregnancyService,
    setNotificationPregnancyComplicationActivationService,
    updateNotificationPregnancyComplicationService
};
