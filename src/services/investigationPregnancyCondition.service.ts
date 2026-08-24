import { InferAttributes, Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { DiagnosticTerm, Investigation, InvestigationMedicalHistory, InvestigationPregnancyCondition } from '../models';
import { AppError, buildDifferentialUpdate, getMessage, toConstantCase } from '../helpers';
import { resolveDiagnosticTermService } from './common/diagnosticTermResolution.service';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { AppDetails, AuthUser, CreateInvestigationPregnancyConditionInput } from '../types';
import { TermSource } from '../constants/enums.constants';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The source that admits implicit creation, and the only one the resolver of F15 ever writes: a
// client cannot coin a MedDRA or WHODrug term by typing one into a form
const LOCAL_SOURCE: TermSource = 'LOCAL';

// The columns the INSERT of ESAVI-INVPREG-001 writes, listed one by one so sortOrder stays out of it.
// Omitting the value is not enough: the column is allowNull: false and Sequelize runs its own notNull
// validation over every attribute of the create before reaching Postgres, so an unlisted sortOrder
// would be rejected in the application and TRG_investigationPregnancyCondition_setSortOrder would
// never get to assign it. Passing the field list is what makes the column absent from the statement.
// pregnancyConditionId is out for the same reason it is out of the body: gen_random_uuid() writes it
const CREATE_FIELDS: (keyof InferAttributes<InvestigationPregnancyCondition>)[] = [
    'investigationId',
    'diagnosticTermId',
    'conditionRaw',
    'notes',
    'isActive',
    'appDetails'
];

// The columns every response carries, listed one by one instead of dropped afterwards. sysDetails is
// trigger bookkeeping and never leaves the service, and an explicit list is what keeps it out without
// having to mention it
const RESPONSE_ATTRIBUTES: (keyof InferAttributes<InvestigationPregnancyCondition>)[] = [
    'pregnancyConditionId',
    'investigationId',
    'diagnosticTermId',
    'conditionRaw',
    'sortOrder',
    'notes',
    'isActive',
    'createdAt',
    'updatedAt',
    'deletedAt',
    'appDetails'
];

// The parent chain, read on every operation to implement the inherited visibility. Two hops, and a
// shape no spec before this one had: the state lives only in the second link. investigationMedicalHistory
// is one of the five tables of the repository with no isActive, so the only thing that can be sealed
// in it is its deletedAt, and the real state of the block lives one hop further up, in
// investigation.isActive.
//
// paranoid: false is what lets the sealed medical history be seen instead of hidden by the include,
// which is the difference between a 404 that can be explained and a mute one.
//
// Neither the medical history nor the investigation ever reaches the response: whoever needs them
// enters through ESAVI-INVMEDH-003 and ESAVI-INVESTGN-003
const MEDICAL_HISTORY_INCLUDE = {
    model: InvestigationMedicalHistory,
    as: 'medicalHistory',
    attributes: ['investigationId', 'deletedAt'],
    paranoid: false,
    include: [{
        model: Investigation,
        as: 'investigation',
        attributes: ['investigationId', 'isActive']
    }]
};

// The resolved master term, with six fields. The jsonb column of the master stays out: it carries the
// internal markers of the implicit resolution — autoCreated, reviewStatus — which are governance of
// the catalog and not data of the investigation. It is the decision of F16 §3.7 and F27 §3.7, literal.
//
// The include does not filter by isActive, deliberately: a term retired after the record was written
// still says what the condition was coded as
const DIAGNOSTIC_TERM_INCLUDE = {
    model: DiagnosticTerm,
    as: 'diagnosticTerm',
    attributes: ['diagnosticTermId', 'source', 'code', 'name', 'termGroup', 'isActive']
};

// The parent chain is dropped here after having done its job in the query, and the master term comes
// back as an explicit null when the condition was recorded without a code, so a client does not have
// to tell "empty" from "absent".
//
// The name the client displays is conditionRaw ?? diagnosticTerm.name. There is no third field
// resolving it, and that is the simplification the DDL imposes: when conditionRaw is null the
// investigator wrote exactly what the master says
const toInvestigationPregnancyConditionResponse = (condition: InvestigationPregnancyCondition) => {
    const plain = condition.toJSON() as Record<string, unknown>;
    delete plain.medicalHistory;

    plain.diagnosticTerm = plain.diagnosticTerm ?? null;

    return plain;
}

// The parent guard of 001, 002A and 002B. A single query over investigationMedicalHistory by primary
// key, with paranoid: false and the investigation nested, that fails with 404 if any of three things
// holds: there is no medical history row, the row has a non null deletedAt — an ESAVI-INVESTGN-005A
// sealed it through cascadeSealSatellite — or its investigation is inactive.
//
// The three reasons share code and message. Telling them apart is of no use to the investigator: in
// all three the missing link is one level up and the corrective action is the same one.
//
// canViewInactive relaxes check 3 and only check 3, and only in the two listings. Checks 1 and 2 are
// relaxed for nobody, SUPERADMIN included: a sealed row IS visible — that is what the paranoid: false
// buys — but a medical history that does not exist has no conditions to list under any role, and one
// that was sealed takes no new rows from anyone. canViewInactive relaxes VISIBILITY, never EXISTENCE.
//
// The column is called investigationId and it does not point at investigation: it points at the
// primary key of the medical history, which is the same UUID. The existence to check is the medical
// history's — a live investigation with no medical history row admits no conditions
const findValidMedicalHistory = async (
    investigationId: string,
    op: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const medicalHistory = await InvestigationMedicalHistory.findOne({
        where: { investigationId, deletedAt: null },
        attributes: ['investigationId'],
        paranoid: false,
        include: [{
            model: Investigation,
            as: 'investigation',
            attributes: ['investigationId'],
            required: true,
            where: canViewInactive ? {} : { isActive: true }
        }]
    });
    if( !medicalHistory ) {
        throw new AppError(
            getMessage('investigationPregnancyCondition.medicalHistoryNotFound', lang),
            404,
            `INVPREG_${ op }_MEDICAL_HISTORY_NOT_FOUND`
        );
    }
    return medicalHistory;
}

// The free texts are normalized on write with trim, and a text that is blank after trimming is no
// text at all. Neither goes through toTitleCase or toConstantCase: conditionName and notes are the
// copy of what the investigator wrote and their only value is reproducing it. There is no code column
// of its own here, and the one of the term is constant cased by resolveDiagnosticTermService.
//
// This is yet another copy of this helper in the repository. Extracting it is overdue since F24 §7
// and has its own spec pending, because doing it here would drag a pile of foreign services into a
// CRUD
const normalizeText = (value: string | null | undefined): string | null => {
    if( value === undefined || value === null ) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

// What the resolution against the clinical master leaves behind: two derived values and not the three
// of F16. This table has a single text column, so there is nowhere to denormalize the canonical name
// or the code — both are read from diagnosticTerm through the include, and that is the simplification
// the DDL imposes. It is the table of F27, literal
interface ResolvedConditionTerm {
    diagnosticTermId: string | null;
    conditionRaw: string | null;
}

// The resolution of ESAVI-INVPREG-001 and 004, in three branches.
//
// Without a code there is no term: the name is the free text of the investigator and there is nothing
// to diverge from, so conditionRaw keeps it as it is. With a code and LOCAL — or no source at all —
// the resolver of F15 answers, creating the term when it does not exist yet, which is the whole point
// of the implicit resolution. With a code and an external source the pair (source, code) is looked up
// and nothing is ever created: a client cannot coin a MedDRA term by writing one in a form.
//
// The external lookup does not filter by isActive, for the same reason
// diagnosticTermResolution.service.ts:37-38 does not: a retired term is still referenceable, and
// resolving away from it would silently undo an administrator's decision.
//
// Whatever the branch, the master rules over the name and the divergence is preserved: conditionRaw
// holds what the investigator wrote and only when it differs from what the catalog says. When it
// comes back null the investigator wrote exactly the name of the master
const resolveConditionTerm = async (
    conditionCode: string | null | undefined,
    conditionName: string,
    source: TermSource | null | undefined,
    op: string,
    authUser: AuthUser | undefined,
    lang: string,
    transaction: Transaction
): Promise<ResolvedConditionTerm> => {
    const rawName = conditionName.trim();
    const trimmedCode = normalizeText(conditionCode);

    if( !trimmedCode ) {
        return { diagnosticTermId: null, conditionRaw: rawName };
    }

    // Same normalization as ESAVI-DIAGTERM-001, 006 and 007, or neither branch would find what the
    // catalog saved. It is applied to the code and never to the name: the toConstantCase belongs to
    // the resolver's contract, and the name is the investigator's text
    const code = toConstantCase(trimmedCode);
    let term: DiagnosticTerm | null;

    if( !source || source === LOCAL_SOURCE ) {
        term = await resolveDiagnosticTermService(
            { code, name: rawName, operationCode: `ESAVI-INVPREG-${ op }` },
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
                getMessage('investigationPregnancyCondition.diagnosticTermNotFound', lang, { code, source }),
                404,
                `INVPREG_${ op }_DIAGTERM_NOT_FOUND`
            );
        }
    }

    return {
        diagnosticTermId: term.diagnosticTermId,
        conditionRaw: term.name === rawName ? null : rawName
    };
}

// The duplicate guard of 001 and 004: the diagnosticTermId may not repeat among the ACTIVE conditions
// of the same medical history. Recording the same condition twice adds no information and does
// distort any count.
//
// F27 compared the pair (diagnosticTermId, complicationTypeItemId) because it had a type catalog.
// Here there is none — this table has no conditionTypeItemId at all — so the pair reduces to one.
//
// No UNIQUE and no index backs it: the DDL declares no unique constraint over this table, and the
// only uniqueness of the database lives in the partial index over (investigationId, sortOrder). It is
// a business rule of the service, and that is precisely why it only looks at ACTIVE rows: an invented
// rule must not be stricter than the ones the database imposes, and deactivating a condition and
// loading it again is the natural way of undoing a mistaken create without going through the 005B.
//
// It only runs when the term has a value. Two free text conditions are distinct records by
// definition: there is no identity to compare, and comparing null against null would turn the second
// free text into a 409 for no reason.
//
// It runs AFTER the resolution, never before: what is compared is the resolved term and not the code
// that arrived, because two different codes can resolve to the same term and comparing codes would
// let through the very duplicate the rule exists to prevent
const assertNoDuplicateCondition = async (
    investigationId: string,
    diagnosticTermId: string | null,
    op: string,
    lang: string,
    transaction: Transaction,
    excludedConditionId?: string
) => {
    if( !diagnosticTermId ) return;

    const duplicate = await InvestigationPregnancyCondition.findOne({
        where: {
            investigationId,
            diagnosticTermId,
            isActive: true,
            ...( excludedConditionId ? { pregnancyConditionId: { [Op.ne]: excludedConditionId } } : {} )
        },
        attributes: ['pregnancyConditionId'],
        transaction
    });
    if( duplicate ) {
        throw new AppError(
            getMessage('investigationPregnancyCondition.alreadyExists', lang),
            409,
            `INVPREG_${ op }_ALREADY_EXISTS`
        );
    }
}

// The read every operation shares to build its response. The parent include is mandatory and not
// decorative: with required: true it is what implements the inherited visibility, so a condition
// hanging from a sealed medical history — or from an inactive investigation — simply does not come
// back.
//
// The intermediate link is filtered by deletedAt and not by isActive, because that table does not
// have the column, and the paranoid: false is what lets a sealed row be seen at all
const findConditionWithRelations = async (id: string, includeInactive: boolean = false) => {
    return await InvestigationPregnancyCondition.findOne({
        where: includeInactive ? { pregnancyConditionId: id } : { pregnancyConditionId: id, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [
            {
                ...MEDICAL_HISTORY_INCLUDE,
                required: true,
                where: includeInactive ? {} : { deletedAt: null },
                include: [{
                    ...MEDICAL_HISTORY_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            DIAGNOSTIC_TERM_INCLUDE
        ]
    });
}

// The read ESAVI-INVPREG-004 works from. Two differences with the one above, and both are deliberate.
// It does not narrow the attributes: buildDifferentialUpdate compares the whole stored row, and an
// instance read with a narrowed `attributes` reads back undefined for what it left out, so every
// comparison would count as a change. And it keeps the diagnosticTerm include, because the update
// needs the master's name to compute the effective name and its code and source to decide whether the
// resolution has to run again.
//
// The parent chain stays, so the inherited visibility is checked in the same query the update
// instance comes from
const findConditionRow = async (id: string, includeInactive: boolean = false, transaction?: Transaction) => {
    return await InvestigationPregnancyCondition.findOne({
        where: includeInactive ? { pregnancyConditionId: id } : { pregnancyConditionId: id, isActive: true },
        include: [
            {
                ...MEDICAL_HISTORY_INCLUDE,
                required: true,
                where: includeInactive ? {} : { deletedAt: null },
                include: [{
                    ...MEDICAL_HISTORY_INCLUDE.include[0],
                    required: true,
                    where: includeInactive ? {} : { isActive: true }
                }]
            },
            DIAGNOSTIC_TERM_INCLUDE
        ],
        transaction
    });
}

// Create Investigation Pregnancy Condition Service
// Code: ESAVI-INVPREG-001
// Everything inside a single transaction, because the resolution against the clinical master may
// write in diagnosticTerm
const createInvestigationPregnancyConditionService = async (
    data: CreateInvestigationPregnancyConditionInput,
    authUser: AuthUser | undefined,
    lang: string
) => {
    const transaction = await sequelize.transaction();
    let createdId: string;

    try {
        // No relaxation of any of the three checks here, not even for SUPERADMIN: a sealed medical
        // history, or one of an inactive investigation, takes no new conditions whoever asks. It is
        // the criterion of F31 §3.5 for its 001
        await findValidMedicalHistory(data.investigationId, '001', lang);

        const resolved = await resolveConditionTerm(
            data.conditionCode,
            data.conditionName,
            data.source,
            '001',
            authUser,
            lang,
            transaction
        );

        // After the resolution and never before: what is compared is the resolved term, not the code
        // that arrived. With no term nothing is checked
        await assertNoDuplicateCondition(
            data.investigationId,
            resolved.diagnosticTermId,
            '001',
            lang,
            transaction
        );

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-INVPREG-001',
            detail: 'Investigation pregnancy condition created by service'
        };

        // sortOrder is deliberately absent from the create: leaving the column out of the INSERT is
        // what lets TRG_investigationPregnancyCondition_setSortOrder assign it, under the advisory
        // lock that keeps two concurrent inserts from colliding. Sending an explicit 0 would work by
        // accident, not by contract
        const created = await InvestigationPregnancyCondition.create({
            investigationId: data.investigationId,
            diagnosticTermId: resolved.diagnosticTermId,
            conditionRaw: resolved.conditionRaw,
            notes: normalizeText(data.notes),
            isActive: data.isActive ?? true,
            appDetails: [newEntry]
        }, { transaction, fields: CREATE_FIELDS });

        createdId = created.pregnancyConditionId;

        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }

    // Re-read so the response carries the resolved master term and the sortOrder the trigger
    // assigned, which the create instance does not know
    const condition = await findConditionWithRelations(createdId, true);
    return condition ? toInvestigationPregnancyConditionResponse(condition) : null;
}

// Get Active Investigation Pregnancy Conditions By Investigation Service
// Code: ESAVI-INVPREG-002A
// The listing is entered by the foreign key and never by /: a recorded condition does not exist
// without its medical history, and a global listing has no reader. It is not entered by the case
// either — that would add a hop the client has already walked, since whoever reaches the conditions
// got the investigationId from ESAVI-INVESTGN-006, and that same UUID is the primary key of the
// medical history.
//
// Ordered by sortOrder ascending, which is the whole point of the column, and with no filter by
// diagnosticTermId or text — those are out of the scope of this spec.
//
// A visible medical history with no conditions answers 200 with { count: 0, rows: [] }, and only a
// medical history that fails the guard answers 404. It is the difference with F31, whose listing
// guarded against investigation, where an investigation with no members was the only case possible
const getInvestigationPregnancyConditionsByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await findValidMedicalHistory(investigationId, '002A', lang, canViewInactive);

    const conditions = await InvestigationPregnancyCondition.findAndCountAll({
        where: { investigationId, isActive: true },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });

    return {
        count: conditions.count,
        rows: conditions.rows.map(toInvestigationPregnancyConditionResponse)
    };
}

// Get All Investigation Pregnancy Conditions By Investigation Service - For Admin
// Code: ESAVI-INVPREG-002B
// The same listing as 002A without the isActive filter: it is the only door to a condition that was
// retired, and therefore the entry point of whoever is going to reactivate or purge it.
// paranoid: false is declarative here — the model is not paranoid, so deletedAt is a plain column and
// no scope would hide the sealed rows — and it is written for the same reason
// entityActivation.service.ts:21 writes it: the intent is to see everything, including what a 005A
// sealed. Those are exactly the rows IX_investigationPregnancyCondition_investigation exists for: the
// partial unique index of esaviapp.sql:1357-1358 leaves them out.
//
// The parent guard still applies: an ADMIN sees inactive conditions, not the conditions of a medical
// history that does not exist
const getAllInvestigationPregnancyConditionsByInvestigationService = async (
    investigationId: string,
    lang: string,
    canViewInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    await findValidMedicalHistory(investigationId, '002B', lang, canViewInactive);

    const conditions = await InvestigationPregnancyCondition.findAndCountAll({
        where: { investigationId },
        attributes: RESPONSE_ATTRIBUTES,
        include: [DIAGNOSTIC_TERM_INCLUDE],
        order: [['sortOrder', 'ASC']],
        paranoid: false,
        limit,
        offset
    });

    return {
        count: conditions.count,
        rows: conditions.rows.map(toInvestigationPregnancyConditionResponse)
    };
}

// Get Investigation Pregnancy Condition By ID Service
// Code: ESAVI-INVPREG-003
// Three filters, and two of them are the inherited visibility in chain: the condition must exist and
// be active, the medical history it hangs from must not be sealed, and the investigation that medical
// history hangs from must be active — unless canViewInactive says otherwise, today SUPERADMIN.
//
// The intermediate link is checked by deletedAt and not by isActive, because that table has no such
// column: it is the first visibility chain of the repository that crosses a table with no state of
// its own.
//
// The three conditions are evaluated the same way, with no priority among them: it is enough that one
// fails, so there is nothing to decide when two of them fail at once. The three failures answer the
// same 404 without distinguishing, because telling them apart would confirm to a USER that a
// condition exists under an investigation it is not allowed to see.
//
// The :id is the pregnancyConditionId. This is NOT the access by investigation — that is the 002A
const getInvestigationPregnancyConditionByIdService = async (
    id: string,
    lang: string,
    canViewInactive: boolean = false
) => {
    const condition = await findConditionWithRelations(id, canViewInactive);
    if( !condition ) {
        throw new AppError(
            getMessage('investigationPregnancyCondition.notFound', lang),
            404,
            'INVPREG_003_NOT_FOUND'
        );
    }
    return toInvestigationPregnancyConditionResponse(condition);
}

// Update Investigation Pregnancy Condition Service
// Code: ESAVI-INVPREG-004
// Everything inside a single transaction, for the same reason as the 001: the resolution against the
// clinical master may write in diagnosticTerm.
//
// investigationId and sortOrder are ignored whether or not they arrive in the body, and neither
// answers 400: the first one is immutable — moving a condition to another investigation is not
// updating it, it is creating a different one — and the second one is governed by the database
const updateInvestigationPregnancyConditionService = async (
    id: string,
    data: Partial<CreateInvestigationPregnancyConditionInput>,
    authUser: AuthUser | undefined,
    lang: string,
    canViewInactive: boolean = false
) => {
    const transaction = await sequelize.transaction();

    try {
        const condition = await findConditionRow(id, canViewInactive, transaction);
        if( !condition ) {
            throw new AppError(
                getMessage('investigationPregnancyCondition.notFound', lang),
                404,
                'INVPREG_004_NOT_FOUND'
            );
        }

        // The whole row, never narrowed: that is the precondition of buildDifferentialUpdate
        const stored = condition.get({ plain: true }) as Record<string, unknown>;
        const storedTerm = stored.diagnosticTerm as { code: string | null, name: string, source: TermSource } | null;

        // What the GET shows as the name of the condition, and the only thing an incoming
        // conditionName can be compared against: this table has a single text column, so
        // storedEffectiveName is unambiguous where F16 had to choose between two columns
        const storedEffectiveName = ( stored.conditionRaw as string | null ) ?? storedTerm?.name ?? null;

        // The second condition is the trap F16 documented and paid for, and F27 simplified. Without
        // it a PUT resending the whole response of its GET would rewrite conditionRaw on every row
        // with a divergence, and the text the investigator wrote would disappear with nobody
        // noticing. A conditionName arriving EQUAL to what the GET displayed is not a rewrite, so it
        // falls through to the fallback exactly like an absent key
        const incomingName = data.conditionName !== undefined
                && normalizeText(data.conditionName) !== storedEffectiveName
            ? normalizeText(data.conditionName)
            : storedEffectiveName;

        // The resolution is re-fired by the change of value, never by the presence of the key
        // (SPEC F12). The stored code and source are the ones of the term that was resolved, read
        // from the include: a PUT resending them consults nothing and writes nothing
        const storedCode = storedTerm?.code ?? null;
        const storedSource = storedTerm?.source ?? null;

        const codeArrived = data.conditionCode !== undefined;
        const trimmedIncomingCode = normalizeText(data.conditionCode);
        const incomingCode = codeArrived
            ? ( trimmedIncomingCode ? toConstantCase(trimmedIncomingCode) : null )
            : storedCode;
        const sourceArrived = data.source !== undefined && data.source !== null;
        const incomingSource = sourceArrived ? ( data.source as TermSource ) : storedSource;

        const mustResolveAgain = incomingCode !== storedCode
            || ( sourceArrived && incomingSource !== storedSource )
            || incomingName !== storedEffectiveName;

        const resolved: ResolvedConditionTerm = mustResolveAgain
            ? await resolveConditionTerm(
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
                conditionRaw: stored.conditionRaw as string | null
            };

        // The guard runs over the RESULTING term and excludes the row itself, so re-sending its own
        // term is a 200 that writes nothing while landing on another live sister is a 409. Before the
        // diff and independently of it
        await assertNoDuplicateCondition(
            stored.investigationId as string,
            resolved.diagnosticTermId,
            '004',
            lang,
            transaction,
            id
        );

        // investigationId, sortOrder and isActive are deliberately absent: the first two are
        // immutable and the state moves through 005A and 005B. The two derived fields enter ALWAYS —
        // with the resolved value or with the stored one — so a resolution that did not change
        // anything produces no diff and therefore no write.
        //
        // conditionName does not appear here because it is not a column: it enters through the two
        // derived fields
        const candidates: Record<string, unknown> = {
            diagnosticTermId: resolved.diagnosticTermId,
            conditionRaw: resolved.conditionRaw,
            // Trimmed and never title cased, or a PUT resending the GET would rewrite what the
            // investigator wrote
            notes: data.notes !== undefined ? normalizeText(data.notes) : undefined
        };

        // Nothing changed: no UPDATE, no updatedAt and no audit entry. It also spares the row the
        // sysDetails.version bump that TRG_investigationPregnancyCondition_setSysDetails fires on
        // every write
        const objectToUpdate = buildDifferentialUpdate(stored, candidates);
        if( Object.keys(objectToUpdate).length > 0 ) {
            // Written by hand so the service does not depend on a trigger for a column it owns: the
            // generic loop of esaviapp.sql drops TRG_<table>_setUpdatedAt and never creates it
            objectToUpdate.updatedAt = new Date();

            // The history is extended, never overwritten
            const currentAppDetails = Array.isArray(condition.appDetails)
                ? condition.appDetails
                : [];
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-INVPREG-004',
                detail: 'Investigation pregnancy condition updated by service'
            };
            await condition.update({
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

    // Re-read so the response carries the resolved master term with its six fields, whether or not
    // anything was written
    const updated = await findConditionWithRelations(id, true);
    return updated ? toInvestigationPregnancyConditionResponse(updated) : null;
}

// Set Investigation Pregnancy Condition Activation Service
// Code: ESAVI-INVPREG-005A / ESAVI-INVPREG-005B
// One service for the two operations, as the rest of the repository does it. Neither is a
// differential update: they are state writes with an intent of their own, they record a fact even
// though no data column changes, and that is why they go through setEntityActiveStatusService and
// never through buildDifferentialUpdate.
//
// The 005A seals deletedAt, which frees the sortOrder from the partial unique index. That is correct
// and deliberate: the gap stays available for the next condition.
//
// Neither operation applies the inherited visibility, and that is the criterion of F31 §3.5: whoever
// withdraws or reactivates acts over the row's own state, and that state exists independently of its
// two parents. Retiring a condition of an inactive investigation answers 200.
//
// The 005A is blocked by nothing. investigationPregnancyCondition is a leaf of the graph: no table of
// the 45 references it, so there are no children to query and no state to drag — least of all its
// parent's isPregnancyConfirmed, which stays governed by F32
const setInvestigationPregnancyConditionActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const condition = await setEntityActiveStatusService({
            model: InvestigationPregnancyCondition,
            where: { pregnancyConditionId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('investigationPregnancyCondition.notFound', lang),
            notFoundCode: `INVPREG_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`investigationPregnancyCondition.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `INVPREG_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-INVPREG-${ op }`,
                detail: `Investigation pregnancy condition ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return condition;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createInvestigationPregnancyConditionService,
    getInvestigationPregnancyConditionByIdService,
    setInvestigationPregnancyConditionActivationService,
    updateInvestigationPregnancyConditionService,
    getInvestigationPregnancyConditionsByInvestigationService,
    getAllInvestigationPregnancyConditionsByInvestigationService
}
