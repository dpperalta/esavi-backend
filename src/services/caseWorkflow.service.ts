import { Op, Transaction, WhereOptions } from 'sequelize';

import { CaseWorkflow, CatalogItem, CatalogType, Classification, EsaviCase, FinalClassification, Investigation, Notification } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { AppDetails, AuthUser, CaseWorkflowListFilters, CaseWorkflowStage, CreateCaseWorkflowInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { sequelize } from '../database/connection';
import { setEntityActiveStatusService } from './common/entityActivation.service';

/**
 * caseWorkflow — administrative progress of the case file (SPEC F44).
 *
 * The status this file moves is NOT the clinical outcome of the patient: that one lives in
 * `investigation.statusItemId`, over the `investigationStatus` catalog. The two are orthogonal —
 * a closed file can belong to a patient who never recovered, and a recovered patient can have an
 * open file.
 *
 * NO WRITE HERE IS A DIFFERENTIAL UPDATE — the diff helper of CONVENTIONS.md §11 is
 * deliberately absent, and §3.5 of the spec reasons it out one by one: a create never goes
 * through the helper, the transitions are writes with an intent of their own whose value differs
 * from the stored one by construction, and the activations are excluded by §11 itself. There is
 * no 004 because no column of this table is written by a human.
 */

// Code of the catalogType that groups the eight workflow states. Seeded by esaviapp.sql with
// upsertCatalogItem; if it is missing the deployment is broken, not the request
const WORKFLOW_STATUS_CATALOG_CODE = 'caseWorkflowStatus';

// The eight states of the file, by their catalogItem code
const STATUS = {
    OPEN: 'OPEN',
    IN_CLASSIFICATION: 'IN_CLASSIFICATION',
    IN_NOTIFICATION: 'IN_NOTIFICATION',
    IN_INVESTIGATION: 'IN_INVESTIGATION',
    IN_FINAL_CLASSIFICATION: 'IN_FINAL_CLASSIFICATION',
    PENDING_VALIDATION: 'PENDING_VALIDATION',
    CLOSED: 'CLOSED',
    REOPENED: 'REOPENED'
} as const;

// The four stages in process order. The index is what "the previous stage" means when 012 seals
// the end of the one before the stage that is starting
const STAGES: CaseWorkflowStage[] = [
    'CLASSIFICATION',
    'NOTIFICATION',
    'INVESTIGATION',
    'FINAL_CLASSIFICATION'
];

// The column prefix of each stage. The eight stamps are `<prefix>StartedAt` and `<prefix>EndedAt`,
// so one map replaces eight branches — and adding a stage means adding one entry, not eight
const STAGE_FIELD: Record<CaseWorkflowStage, string> = {
    CLASSIFICATION: 'classification',
    NOTIFICATION: 'notification',
    INVESTIGATION: 'investigation',
    FINAL_CLASSIFICATION: 'finalClassification'
};

// The status the file moves to when a stage starts
const STAGE_STATUS: Record<CaseWorkflowStage, string> = {
    CLASSIFICATION: STATUS.IN_CLASSIFICATION,
    NOTIFICATION: STATUS.IN_NOTIFICATION,
    INVESTIGATION: STATUS.IN_INVESTIGATION,
    FINAL_CLASSIFICATION: STATUS.IN_FINAL_CLASSIFICATION
};

const startedAtField = (stage: CaseWorkflowStage): string => `${ STAGE_FIELD[stage] }StartedAt`;
const endedAtField = (stage: CaseWorkflowStage): string => `${ STAGE_FIELD[stage] }EndedAt`;

// The status of the row, resolved to its code. Every transition needs it and none of them may
// return it: the `catalogItem` travels in the response of the HTTP operations, never sysDetails
const STATUS_INCLUDE = {
    model: CatalogItem,
    as: 'status',
    attributes: ['catalogItemId', 'code', 'name'],
    required: false
};

const stampOf = (workflow: CaseWorkflow, field: string): Date | null =>
    ( workflow.get(field as keyof CaseWorkflow) as Date | null ) ?? null;

/**
 * Resolves a workflow state by its `code` under the `caseWorkflowStatus` catalogType.
 *
 * A miss here is **500 and not 404**: the eight items are seeded by the schema, so their absence
 * is a deployment failure and not something the caller sent wrong. Following the precedent of
 * `investigation.statusItemId`, the check lives in the service and there is no validation trigger
 * on the column.
 */
const resolveStatusItem = async (
    code: string,
    op: string,
    lang: string,
    transaction?: Transaction
): Promise<CatalogItem> => {
    const statusItem = await CatalogItem.findOne({
        where: { code, isActive: true },
        attributes: ['catalogItemId', 'code', 'name'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: WORKFLOW_STATUS_CATALOG_CODE },
            attributes: []
        }],
        transaction
    });

    if( !statusItem ) {
        throw new AppError(
            getMessage('caseWorkflow.statusNotFound', lang),
            500,
            `CASEFLOW_${ op }_STATUS_NOT_FOUND`
        );
    }

    return statusItem;
}

// ESAVI-CASEFLOW-001 - Create Case Workflow Service
/**
 * Opens the workflow of a case in `OPEN`.
 *
 * **No HTTP route.** `createEsaviCaseService` invokes it inside its own transaction, which is the
 * only way to guarantee the invariant "every case created after this spec has a workflow row".
 * For that same reason it does **not** validate that the case exists: it is being created in the
 * same unit of work, so a lookup would find nothing and reject a perfectly valid case.
 *
 * The client supplies nothing beyond the `caseId`: the initial status is always `OPEN`,
 * `openedAt` is the instant of the creation and `reopenCount` starts at zero.
 */
const createCaseWorkflowService = async (
    data: CreateCaseWorkflowInput,
    authUser: AuthUser | undefined,
    lang: string,
    transaction?: Transaction
): Promise<CaseWorkflow> => {
    const { caseId } = data;
    try {
        // UQ_caseWorkflow_case would reject the second row with a database error; this check turns
        // it into the 409 the contract declares. Inactive rows count: the unique constraint has no
        // partial predicate, so a deactivated workflow still occupies the slot of its case
        const existingWorkflow = await CaseWorkflow.findOne({
            where: { caseId },
            attributes: ['caseWorkflowId'],
            transaction
        });

        if( existingWorkflow ) {
            throw new AppError(
                getMessage('caseWorkflow.workflowExists', lang, { caseId }),
                409,
                'CASEFLOW_001_WORKFLOW_EXISTS'
            );
        }

        const openStatus = await resolveStatusItem(STATUS.OPEN, '001', lang, transaction);

        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-CASEFLOW-001',
            detail: 'Case workflow opened by service'
        };

        return await CaseWorkflow.create({
            caseId,
            statusItemId: openStatus.catalogItemId,
            // Written explicitly instead of leaning on the DEFAULT of the column: the instant the
            // file opens is a fact of the domain, and it belongs in the same statement that
            // records who opened it
            openedAt: new Date(),
            reopenCount: 0,
            appDetails: [newEntry]
        }, { transaction });
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-001 - Error creating case workflow for case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(
            getMessage('caseWorkflow.createdFailed', lang),
            500,
            'CASEFLOW_001_CREATE_FAILED',
            error
        );
    }
}

// -----------------------------------------------------------------------------
// Response shape (SPEC F44 §3.7)
// -----------------------------------------------------------------------------

// The primary key of each stage satellite, and the alias EsaviCase exposes it under. The four
// relations are one to one by their own UNIQUE ("caseId"), so each include resolves at most one
// row and uses its index
const STAGE_SATELLITE: Record<CaseWorkflowStage, { alias: string; primaryKey: string }> = {
    CLASSIFICATION: { alias: 'classification', primaryKey: 'classificationId' },
    NOTIFICATION: { alias: 'notification', primaryKey: 'notificationId' },
    INVESTIGATION: { alias: 'investigation', primaryKey: 'investigationId' },
    FINAL_CLASSIFICATION: { alias: 'finalClassification', primaryKey: 'finalClassificationId' }
};

/**
 * The four satellites, nested under the `case` include and narrowed to their primary key.
 *
 * `required: false` in all four, or a case with no classification would vanish from the listing
 * altogether.
 *
 * **There is no filter at all, and that is the point.** A deactivated stage counts as existing and
 * keeps its `id`: its row is still there and a POST would hit the UNIQUE, so what the client needs
 * then is to reactivate it with its 005B, not to create it again. Filtering by `isActive` — or by
 * `deletedAt IS NULL`, which the soft delete of 005A writes together with it — would hide exactly
 * the row §3.7 wants shown, and send the client into a 409 it cannot explain. Only a physical
 * delete makes the `id` disappear, and these four tables do not allow one.
 *
 * This is one include and not four `findOne` per row, so the number of queries does not grow with
 * the page size.
 */
const STAGE_INCLUDES = [
    { model: Classification, as: 'classification', attributes: ['classificationId'], required: false },
    { model: Notification, as: 'notification', attributes: ['notificationId'], required: false },
    { model: Investigation, as: 'investigation', attributes: ['investigationId'], required: false },
    { model: FinalClassification, as: 'finalClassification', attributes: ['finalClassificationId'], required: false }
];

const CASE_INCLUDE = {
    model: EsaviCase,
    as: 'case',
    attributes: ['caseId', 'caseCode'],
    include: STAGE_INCLUDES
};

const PREVIOUS_STATUS_INCLUDE = {
    model: CatalogItem,
    as: 'previousStatus',
    attributes: ['catalogItemId', 'code', 'name'],
    required: false
};

const DETAIL_INCLUDE = [CASE_INCLUDE, STATUS_INCLUDE, PREVIOUS_STATUS_INCLUDE];

// Newest file first. openedAt and not createdAt: the two are written in the same statement, but
// openedAt is the one that means something in the domain
const LIST_ORDER: [string, string][] = [['openedAt', 'DESC']];

const MINUTE_IN_MS = 60 * 1000;

// Whole minutes between two stamps, or null when either is missing. It is never stored: it is a
// pure derivative of two columns of the same row, and keeping it in sync would buy no query
const durationMinutes = (startedAt: Date | null, endedAt: Date | null): number | null =>
    startedAt && endedAt
        ? Math.round(( endedAt.getTime() - startedAt.getTime() ) / MINUTE_IN_MS)
        : null;

const toIso = (value: Date | null): string | null => value ? value.toISOString() : null;

const toCatalogRef = (item: CatalogItem | undefined | null) =>
    item ? { catalogItemId: item.catalogItemId, code: item.code, name: item.name } : null;

/**
 * The `stages` block of §3.7: the two stamps, the duration and the identity of the real row.
 *
 * `exists` and `id` are what let a client resume a half-captured file without guessing:
 * `exists: false` means POST the stage, `exists: true` means PUT over the `id` returned. They are
 * independent of the stamps on purpose — a `startedAt` with `id: null` and an `id` with no
 * `startedAt` are both anomalies, and folding them into a single boolean would hide them.
 */
const buildStages = (workflow: CaseWorkflow) => {
    const esaviCase = workflow.case as ( EsaviCase & Record<string, unknown> ) | undefined;
    const stages: Record<string, unknown> = {};

    for( const stage of STAGES ) {
        const { alias, primaryKey } = STAGE_SATELLITE[stage];
        const satellite = esaviCase?.[alias] as Record<string, unknown> | null | undefined;
        const id = ( satellite?.[primaryKey] as string | undefined ) ?? null;

        const startedAt = stampOf(workflow, startedAtField(stage));
        const endedAt = stampOf(workflow, endedAtField(stage));

        stages[alias] = {
            exists: id !== null,
            id,
            startedAt: toIso(startedAt),
            endedAt: toIso(endedAt),
            durationMinutes: durationMinutes(startedAt, endedAt)
        };
    }

    return stages;
}

/**
 * The full shape of 003, 006 and 007-011, and of every row of 002A and 002B.
 *
 * The eight column stamps are grouped into `stages` instead of travelling loose: eight fields the
 * client has to pair up by hand are eight chances to pair them wrong. `sysDetails` never leaves
 * the service, and neither do the three raw foreign keys — the response carries the resolved
 * `status`, `previousStatus` and the stage identities instead.
 */
const toCaseWorkflowResponse = (workflow: CaseWorkflow) => {
    const openedAt = stampOf(workflow, 'openedAt');
    const closedAt = stampOf(workflow, 'closedAt');

    return {
        caseWorkflowId: workflow.caseWorkflowId,
        caseId: workflow.caseId,
        status: toCatalogRef(workflow.status),
        previousStatus: toCatalogRef(workflow.previousStatus),
        openedAt: toIso(openedAt),
        closedAt: toIso(closedAt),
        lastReopenedAt: toIso(stampOf(workflow, 'lastReopenedAt')),
        reopenCount: workflow.reopenCount,
        stages: buildStages(workflow),
        // null while the file is open. The elapsed time of a live case is computed by the client
        // against its own clock: the server never returns a value that changes between two
        // identical calls
        totalDurationMinutes: durationMinutes(openedAt, closedAt),
        isActive: workflow.isActive,
        createdAt: toIso(stampOf(workflow, 'createdAt')),
        updatedAt: toIso(stampOf(workflow, 'updatedAt')),
        deletedAt: toIso(stampOf(workflow, 'deletedAt')),
        appDetails: workflow.appDetails ?? []
    };
}

/**
 * The three filters that need no resolution, accumulated with AND. A filter pointing at a row
 * that does not exist yields an empty page, never a 404: searching for something absent is an
 * empty search, not a missing resource. `statusCode` is the exception and is resolved by the
 * caller — it is a name of the catalog, and a name that does not exist IS a 404.
 */
const buildListWhere = (filters: CaseWorkflowListFilters, statusItemId?: string): WhereOptions => {
    const where: Record<string, unknown> = {};

    if( filters.caseId ) where.caseId = filters.caseId;
    if( statusItemId ) where.statusItemId = statusItemId;

    const from = filters.openedFrom ? new Date(filters.openedFrom) : undefined;
    const to = filters.openedTo ? new Date(filters.openedTo) : undefined;
    if( from && to ) {
        where.openedAt = { [Op.between]: [from, to] };
    } else if( from ) {
        where.openedAt = { [Op.gte]: from };
    } else if( to ) {
        where.openedAt = { [Op.lte]: to };
    }

    return where as WhereOptions;
}

/**
 * Resolves the `statusCode` filter into the id the where clause needs.
 *
 * The filter travels as the `code` of the catalogItem — `IN_INVESTIGATION`, not its UUID —
 * because the client knows the name of the state, not its identifier. Unlike the 500 of
 * `resolveStatusItem`, an unknown code here is **404**: the client asked for a state that does
 * not exist, which is a mistake in the request and not a broken deployment.
 */
const resolveStatusFilter = async (statusCode: string | undefined, lang: string): Promise<string | undefined> => {
    if( !statusCode ) return undefined;

    const statusItem = await CatalogItem.findOne({
        where: { code: statusCode, isActive: true },
        attributes: ['catalogItemId'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: WORKFLOW_STATUS_CATALOG_CODE },
            attributes: []
        }]
    });

    if( !statusItem ) {
        throw new AppError(
            getMessage('caseWorkflow.statusNotFound', lang),
            404,
            'CASEFLOW_002_STATUS_NOT_FOUND'
        );
    }

    return statusItem.catalogItemId;
}

// ESAVI-CASEFLOW-002A - Get Active Case Workflows Service
/**
 * The public listing. Filters by the `isActive` of the workflow row itself, which is the state
 * 005A and 005B move — not the state of the case file, which is `status`.
 */
const getCaseWorkflowsService = async (
    filters: CaseWorkflowListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
    lang: string
) => {
    const statusItemId = await resolveStatusFilter(filters.statusCode, lang);

    const { count, rows } = await CaseWorkflow.findAndCountAll({
        where: { ...buildListWhere(filters, statusItemId), isActive: true },
        include: DETAIL_INCLUDE,
        order: LIST_ORDER,
        limit,
        offset,
        // The four nested satellite includes multiply the rows of the SQL result, so without this
        // the count would be the number of joined rows and not the number of workflows
        distinct: true
    });

    return { count, rows: rows.map(toCaseWorkflowResponse) };
}

// ESAVI-CASEFLOW-002B - Get All Case Workflows Service - For Admin
const getAllCaseWorkflowsService = async (
    filters: CaseWorkflowListFilters = {},
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET,
    lang: string
) => {
    const statusItemId = await resolveStatusFilter(filters.statusCode, lang);

    const { count, rows } = await CaseWorkflow.findAndCountAll({
        where: buildListWhere(filters, statusItemId),
        include: DETAIL_INCLUDE,
        order: LIST_ORDER,
        limit,
        offset,
        distinct: true
    });

    return { count, rows: rows.map(toCaseWorkflowResponse) };
}

// ESAVI-CASEFLOW-003 - Get Case Workflow By ID Service
/**
 * The canonical read, by `caseWorkflowId`.
 *
 * Inactive rows are only visible to whoever passes `canViewInactive`; for everyone else they are
 * a 404, exactly as if they did not exist. Note that `isActive` is the state of the **workflow
 * record** — what 005A and 005B move — and has nothing to do with whether the case file is
 * closed, which is `status`.
 */
const getCaseWorkflowByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const where = canViewInactive ? { caseWorkflowId: id } : { caseWorkflowId: id, isActive: true };

    const workflow = await CaseWorkflow.findOne({
        where,
        include: DETAIL_INCLUDE
    });

    if( !workflow ) {
        throw new AppError(getMessage('caseWorkflow.notFound', lang), 404, 'CASEFLOW_003_NOT_FOUND');
    }

    return toCaseWorkflowResponse(workflow);
}

// ESAVI-CASEFLOW-006 - Get Case Workflow By Case ID Service
/**
 * The workflow of a case, entered through the `caseId`.
 *
 * **This is the call a client resumes a file with.** Together with the status and the stamps it
 * resolves the primary key of the four stages (`exists` and `id`, §3.7), so one request is enough
 * to know which step to continue at and whether each stage is created with a POST or updated with
 * a PUT. The four satellites are resolved by the same `include` that loads the workflow, so it is
 * one round trip and not five.
 *
 * **Two distinct 404s, on purpose.** `CASEFLOW_006_CASE_NOT_FOUND` means the case does not exist;
 * `CASEFLOW_006_NOT_FOUND` means it exists but has no workflow row, which only happens for cases
 * created before this spec. That second one is the symptom the backfill will have to resolve, and
 * folding them into a single code would hide it.
 *
 * The lookup needs no LIMIT beyond findOne: UQ_caseWorkflow_case guarantees there is at most one
 * row per case.
 */
const getCaseWorkflowByCaseIdService = async (caseId: string, lang: string, canViewInactive: boolean = false) => {
    const where = canViewInactive ? { caseId } : { caseId, isActive: true };

    // The case lookup and the workflow lookup go together: the first one is what tells the two
    // 404s apart, and neither depends on the other's result
    const [esaviCase, workflow] = await Promise.all([
        EsaviCase.findOne({ where: { caseId }, attributes: ['caseId'] }),
        CaseWorkflow.findOne({ where, include: DETAIL_INCLUDE })
    ]);

    if( !esaviCase ) {
        throw new AppError(getMessage('caseWorkflow.caseNotFound', lang), 404, 'CASEFLOW_006_CASE_NOT_FOUND');
    }

    if( !workflow ) {
        throw new AppError(getMessage('caseWorkflow.notFound', lang), 404, 'CASEFLOW_006_NOT_FOUND');
    }

    return toCaseWorkflowResponse(workflow);
}

/**
 * The read every transition ends with, so 007-011 all answer the full record of §3.7.
 *
 * It is a re-read and not the instance the write returned: the transitions update a row loaded
 * without the stage satellites, and the response has to carry `stages` with its `exists` and `id`
 * resolved. Returning the bare instance would answer a shape the client cannot use to continue.
 */
const findCaseWorkflowByCaseId = async (caseId: string, transaction?: Transaction) =>
    await CaseWorkflow.findOne({ where: { caseId }, include: DETAIL_INCLUDE, transaction });

/**
 * The row every transition of 007-011 starts from, with its status resolved to a code.
 *
 * The `where` filters by `caseId` alone and never by `isActive`: `isActive` is the state of the
 * workflow **record**, which 005A and 005B move, and refusing a transition because the record was
 * deactivated would answer a 404 about a case that is plainly there. The operation code travels
 * in so each of the five keeps its own.
 */
const findWorkflowForTransition = async (
    caseId: string,
    op: string,
    lang: string,
    transaction?: Transaction
): Promise<CaseWorkflow> => {
    const workflow = await CaseWorkflow.findOne({
        where: { caseId },
        include: [STATUS_INCLUDE],
        transaction
    });

    if( !workflow ) {
        throw new AppError(getMessage('caseWorkflow.notFound', lang), 404, `CASEFLOW_${ op }_NOT_FOUND`);
    }

    return workflow;
}

// The audit entry every transition appends. Services must spread the existing array, never
// replace it, so the history of the row is preserved
const appendAuditEntry = (workflow: CaseWorkflow, op: string, detail: string, authUser?: AuthUser): AppDetails[] => {
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: `ESAVI-CASEFLOW-${ op }`,
        detail
    };
    return [...( ( workflow.appDetails as AppDetails[] | null ) ?? [] ), newEntry];
}

// ESAVI-CASEFLOW-007 - Complete Case Workflow Stage Service
/**
 * Seals the end of one stage.
 *
 * The start of a stage is an observable fact, propagated by 012 when the stage row is created;
 * the **end is a judgement**, and this is where a person makes it. It seals `<stage>EndedAt` and
 * **does not touch `statusItemId`**: the status is moved by the propagation, never by closing a
 * stage. A file whose classification is finished has not therefore entered notification.
 *
 * Three conflicts, each with its own code: a closed case, a stage that never started, and a stage
 * already completed. The stage name travels into the two stage messages, so the client is not
 * left guessing which of the four the server refused.
 */
const completeCaseWorkflowStageService = async (
    caseId: string,
    stage: CaseWorkflowStage,
    authUser: AuthUser | undefined,
    lang: string
) => {
    try {
        const workflow = await findWorkflowForTransition(caseId, '007', lang);

        if( workflow.status?.code === STATUS.CLOSED ) {
            throw new AppError(getMessage('caseWorkflow.caseClosed', lang), 409, 'CASEFLOW_007_CASE_CLOSED');
        }

        const startedField = startedAtField(stage);
        const endedField = endedAtField(stage);

        if( !stampOf(workflow, startedField) ) {
            throw new AppError(
                getMessage('caseWorkflow.stageNotStarted', lang, { stage }),
                409,
                'CASEFLOW_007_STAGE_NOT_STARTED'
            );
        }

        if( stampOf(workflow, endedField) ) {
            throw new AppError(
                getMessage('caseWorkflow.stageAlreadyCompleted', lang, { stage }),
                409,
                'CASEFLOW_007_STAGE_ALREADY_COMPLETED'
            );
        }

        await workflow.update({
            [endedField]: new Date(),
            appDetails: appendAuditEntry(workflow, '007', `Workflow stage ${ stage } completed`, authUser)
        });

        const updated = await findCaseWorkflowByCaseId(caseId);
        return updated ? toCaseWorkflowResponse(updated) : null;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-007 - Error completing stage ${ stage } of case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(
            getMessage('caseWorkflow.stageCompletedFailed', lang),
            500,
            'CASEFLOW_007_COMPLETE_FAILED',
            error
        );
    }
}

// ESAVI-CASEFLOW-008 - Close Case Workflow Service
/**
 * Closes the case file.
 *
 * Closing is a **decision somebody takes**, not a fact deduced from which rows exist — which is
 * the whole reason this table had to be created. Before writing it, the service checks the four
 * stage preconditions of §3.5:
 *
 * | Stage                | Required when                                                        |
 * |----------------------|----------------------------------------------------------------------|
 * | classification       | always                                                               |
 * | notification         | always                                                               |
 * | investigation        | `notification.requestInvestigation === true`                          |
 * | finalClassification  | `isSeriousEvent === true` **or** `requestInvestigation === true`       |
 *
 * All four look at **active** rows of the case, unlike the `exists` of §3.7, which counts a
 * deactivated stage as present: `exists` answers "would a POST collide?", these answer "was this
 * step of the process actually done?", and a retired row did not do it.
 *
 * Seriousness is read from `classification.isSeriousEvent`, where the user declares it, and a
 * NULL counts as not serious. `notification.notificationType` is deliberately not the source:
 * it is declared one step later, and making the close depend on data posterior to what originates
 * it inverts the flow. The two can contradict each other and the schema does not stop them — the
 * spec records that risk and leaves unifying them to a correction over F09 and F10.
 */
const closeCaseWorkflowService = async (
    caseId: string,
    authUser: AuthUser | undefined,
    lang: string
) => {
    try {
        const workflow = await findWorkflowForTransition(caseId, '008', lang);

        if( workflow.status?.code === STATUS.CLOSED ) {
            throw new AppError(getMessage('caseWorkflow.alreadyClosed', lang), 409, 'CASEFLOW_008_ALREADY_CLOSED');
        }

        // Closing a case somebody sent for review without resolving it empties the state of any
        // meaning: the reviewer would find the file already shut
        if( workflow.status?.code === STATUS.PENDING_VALIDATION ) {
            throw new AppError(getMessage('caseWorkflow.pendingValidation', lang), 409, 'CASEFLOW_008_PENDING_VALIDATION');
        }

        const activeOfCase = { where: { caseId, isActive: true } };
        const [classification, notification, investigation, finalClassification] = await Promise.all([
            Classification.findOne({ ...activeOfCase, attributes: ['classificationId', 'isSeriousEvent'] }),
            Notification.findOne({ ...activeOfCase, attributes: ['notificationId', 'requestInvestigation'] }),
            Investigation.findOne({ ...activeOfCase, attributes: ['investigationId'] }),
            FinalClassification.findOne({ ...activeOfCase, attributes: ['finalClassificationId'] })
        ]);

        if( !classification ) {
            throw new AppError(
                getMessage('caseWorkflow.classificationRequired', lang),
                409,
                'CASEFLOW_008_CLASSIFICATION_REQUIRED'
            );
        }

        if( !notification ) {
            throw new AppError(
                getMessage('caseWorkflow.notificationRequired', lang),
                409,
                'CASEFLOW_008_NOTIFICATION_REQUIRED'
            );
        }

        const investigationRequested = notification.requestInvestigation === true;
        // A NULL is treated as not serious: the classifier who never marked it did not declare a
        // serious event, and reading the absence as a yes would block every ordinary close
        const isSeriousEvent = classification.isSeriousEvent === true;

        if( investigationRequested && !investigation ) {
            throw new AppError(
                getMessage('caseWorkflow.investigationRequired', lang),
                409,
                'CASEFLOW_008_INVESTIGATION_REQUIRED'
            );
        }

        // The two conditions are an OR and cover the four combinations agreed in §3.5: a serious
        // case is formally classified even if it was never investigated, and a non-serious one
        // that WAS investigated drags its final classification along
        if( ( isSeriousEvent || investigationRequested ) && !finalClassification ) {
            throw new AppError(
                getMessage('caseWorkflow.finalClassificationRequired', lang),
                409,
                'CASEFLOW_008_FINAL_CLASSIFICATION_REQUIRED'
            );
        }

        const closedStatus = await resolveStatusItem(STATUS.CLOSED, '008', lang);
        const now = new Date();
        const changes: Record<string, unknown> = {
            closedAt: now,
            statusItemId: closedStatus.catalogItemId,
            previousStatusItemId: null
        };

        // The last stage still open is sealed with the same instant, for the same reason as in
        // 012: no stamp is left orphaned and every duration stays computable. Only the last one —
        // sealing them all would invent an end for phases the file may never have entered
        for( let index = STAGES.length - 1; index >= 0; index-- ) {
            const stage = STAGES[index];
            const startedAt = stampOf(workflow, startedAtField(stage));
            const endedAt = stampOf(workflow, endedAtField(stage));
            if( startedAt && !endedAt ) {
                changes[endedAtField(stage)] = now;
                break;
            }
        }

        await workflow.update({
            ...changes,
            appDetails: appendAuditEntry(workflow, '008', 'Case file closed', authUser)
        });

        const updated = await findCaseWorkflowByCaseId(caseId);
        return updated ? toCaseWorkflowResponse(updated) : null;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-008 - Error closing case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('caseWorkflow.closedFailed', lang), 500, 'CASEFLOW_008_CLOSE_FAILED', error);
    }
}

// ESAVI-CASEFLOW-009 - Reopen Case Workflow Service
/**
 * Reopens a closed case file. ADMIN.
 *
 * `REOPENED` is **transitory**: the next call to 012 takes the file out of it and into the status
 * of whatever stage was created. If it lasted until the next close, a reopened case under
 * investigation would still show as `REOPENED` and its real progress would be lost. What persists
 * instead is the trace — `reopenCount` and `lastReopenedAt`.
 *
 * **`closedAt` is not cleared.** It keeps the instant of the last close and is overwritten by the
 * next one, so a file that was closed and reopened twice still says when it was last finished.
 */
const reopenCaseWorkflowService = async (
    caseId: string,
    authUser: AuthUser | undefined,
    lang: string
) => {
    try {
        const workflow = await findWorkflowForTransition(caseId, '009', lang);

        if( workflow.status?.code !== STATUS.CLOSED ) {
            throw new AppError(getMessage('caseWorkflow.notClosed', lang), 409, 'CASEFLOW_009_NOT_CLOSED');
        }

        const reopenedStatus = await resolveStatusItem(STATUS.REOPENED, '009', lang);

        await workflow.update({
            statusItemId: reopenedStatus.catalogItemId,
            lastReopenedAt: new Date(),
            reopenCount: ( workflow.reopenCount ?? 0 ) + 1,
            appDetails: appendAuditEntry(workflow, '009', 'Case file reopened', authUser)
        });

        const updated = await findCaseWorkflowByCaseId(caseId);
        return updated ? toCaseWorkflowResponse(updated) : null;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-009 - Error reopening case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('caseWorkflow.reopenedFailed', lang), 500, 'CASEFLOW_009_REOPEN_FAILED', error);
    }
}

// ESAVI-CASEFLOW-010 - Request Case Workflow Validation Service
/**
 * Flags the file as needing review before it goes any further.
 *
 * `PENDING_VALIDATION` is **reversible**, and `previousStatusItemId` is the whole mechanism: it
 * keeps the status the request was made from, and 011 restores it. It can be asked for from any
 * open state.
 *
 * Entering and leaving are two different facts, so they are two operations with two codes and two
 * audit entries — not one endpoint that toggles depending on the state. A toggle would save an
 * endpoint at the cost of the operation code no longer saying what was attempted, which is exactly
 * what it exists for.
 */
const requestCaseWorkflowValidationService = async (
    caseId: string,
    authUser: AuthUser | undefined,
    lang: string
) => {
    try {
        const workflow = await findWorkflowForTransition(caseId, '010', lang);

        if( workflow.status?.code === STATUS.PENDING_VALIDATION ) {
            throw new AppError(getMessage('caseWorkflow.alreadyPending', lang), 409, 'CASEFLOW_010_ALREADY_PENDING');
        }

        if( workflow.status?.code === STATUS.CLOSED ) {
            throw new AppError(getMessage('caseWorkflow.caseClosed', lang), 409, 'CASEFLOW_010_CASE_CLOSED');
        }

        const pendingStatus = await resolveStatusItem(STATUS.PENDING_VALIDATION, '010', lang);

        await workflow.update({
            previousStatusItemId: workflow.statusItemId,
            statusItemId: pendingStatus.catalogItemId,
            appDetails: appendAuditEntry(workflow, '010', 'Case validation requested', authUser)
        });

        const updated = await findCaseWorkflowByCaseId(caseId);
        return updated ? toCaseWorkflowResponse(updated) : null;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-010 - Error requesting validation for case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(
            getMessage('caseWorkflow.validationRequestedFailed', lang),
            500,
            'CASEFLOW_010_REQUEST_FAILED',
            error
        );
    }
}

// ESAVI-CASEFLOW-011 - Resolve Case Workflow Validation Service
/**
 * Takes the file out of `PENDING_VALIDATION`, back to where it actually is.
 *
 * The status restored is `previousStatusItemId`, which 010 wrote and which 012 keeps up to date
 * while the validation is pending: a file that advanced two stages during the review comes back
 * to the stage it reached, not to the one it was in when somebody asked for the review.
 *
 * A NULL `previousStatusItemId` here answers **500** with its own code. It is a data inconsistency
 * that 010 makes impossible, and failing loudly beats inventing a status to return the file to.
 */
const resolveCaseWorkflowValidationService = async (
    caseId: string,
    authUser: AuthUser | undefined,
    lang: string
) => {
    try {
        const workflow = await findWorkflowForTransition(caseId, '011', lang);

        if( workflow.status?.code !== STATUS.PENDING_VALIDATION ) {
            throw new AppError(getMessage('caseWorkflow.notPending', lang), 409, 'CASEFLOW_011_NOT_PENDING');
        }

        const previousStatusItemId = workflow.previousStatusItemId;
        if( !previousStatusItemId ) {
            throw new AppError(
                getMessage('caseWorkflow.previousStatusMissing', lang),
                500,
                'CASEFLOW_011_PREVIOUS_STATUS_MISSING'
            );
        }

        await workflow.update({
            statusItemId: previousStatusItemId,
            previousStatusItemId: null,
            appDetails: appendAuditEntry(workflow, '011', 'Case validation resolved', authUser)
        });

        const updated = await findCaseWorkflowByCaseId(caseId);
        return updated ? toCaseWorkflowResponse(updated) : null;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-011 - Error resolving validation for case ${ caseId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(
            getMessage('caseWorkflow.validationResolvedFailed', lang),
            500,
            'CASEFLOW_011_RESOLVE_FAILED',
            error
        );
    }
}

// ESAVI-CASEFLOW-005A / 005B - Set Case Workflow Activation Service
/**
 * Deactivates or reactivates the workflow **record**.
 *
 * **This is not how a case file is closed.** Closing is 008 and reopening is 009; these two are an
 * administrative operation over the row, the same one every other entity has. Confusing the two is
 * the mistake this spec most wants to avoid, and it is why the i18n keys of 005A and 005B speak of
 * "workflow record" and never of "case".
 *
 * There is no 005C: `caseWorkflow` is inside the `preventPhysicalDelete` loop of `esaviapp.sql`,
 * the trigger would reject the DELETE, and the availability rule of CONVENTIONS.md §6 forbids
 * declaring the endpoint.
 *
 * Delegated to `setEntityActiveStatusService` with no logic of its own, and the `where` filters by
 * the primary key alone: the generic service is what tells "does not exist" (404) from "already in
 * that state" (409).
 */
const setCaseWorkflowActivationService = async (
    id: string,
    authUser: AuthUser | undefined,
    lang: string,
    isActive: boolean = true
) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        await setEntityActiveStatusService({
            model: CaseWorkflow,
            where: { caseWorkflowId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('caseWorkflow.notFound', lang),
            notFoundCode: `CASEFLOW_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`caseWorkflow.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `CASEFLOW_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                // The audit entry keeps the operation code and nothing else: no suffixes added
                method: `ESAVI-CASEFLOW-${ op }`,
                detail: `Case workflow record ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-CASEFLOW-012 - Advance Case Workflow Stage Service
/**
 * Moves the file into a stage, sealing its start and closing the previous one.
 *
 * **No HTTP route.** The four stage services — `createClassificationService`,
 * `createNotificationService`, `createInvestigationService` and
 * `createFinalClassificationService` — invoke it inside the transaction that creates their own
 * row, so a stage that cannot move the workflow does not get created either.
 *
 * It does four things, in order:
 *
 *  1. Locates the workflow by `caseId`. A miss means a case created before this spec, and gets
 *     its own code so the symptom is diagnosable — that is what the backfill will have to fix.
 *  2. Rejects a `CLOSED` file. A closed case gains no new stages: it is reopened first.
 *  3. Seals `<stage>StartedAt` **only if it was NULL**, so re-running it never rewrites the
 *     original instant.
 *  4. Closes the previous stage with the **same instant**, if it was left open. No stamp is left
 *     orphaned and every duration stays computable, even if nobody ever runs 007.
 *
 * On the status: it moves to the status of the stage, **unless** the file sits in
 * `PENDING_VALIDATION`. There the status stays put and `previousStatusItemId` is moved instead,
 * so 011 returns the case to where it actually is. Advancing a stage does not cancel a requested
 * validation — that is precisely what the state is for.
 */
const advanceCaseWorkflowStageService = async (
    caseId: string,
    stage: CaseWorkflowStage,
    authUser: AuthUser | undefined,
    lang: string,
    transaction?: Transaction
): Promise<CaseWorkflow> => {
    try {
        const workflow = await CaseWorkflow.findOne({
            where: { caseId },
            include: [STATUS_INCLUDE],
            transaction
        });

        // Distinct from CASEFLOW_006_CASE_NOT_FOUND on purpose: here the case exists — it is its
        // workflow row that is missing, which only happens for cases created before this spec
        if( !workflow ) {
            throw new AppError(
                getMessage('caseWorkflow.notFound', lang),
                404,
                'CASEFLOW_012_NOT_FOUND'
            );
        }

        // The only rule of process this service enforces, and it has no backing in the schema:
        // no column and no constraint imposes it. Retiring it is one line, with no migration and
        // no contract change — SPEC F44 §3.5 says so explicitly for whoever evaluates it later
        if( workflow.status?.code === STATUS.CLOSED ) {
            throw new AppError(
                getMessage('caseWorkflow.caseClosed', lang),
                409,
                'CASEFLOW_012_CASE_CLOSED'
            );
        }

        // One instant for the whole transition: the start of this stage and the end of the
        // previous one are the same moment, which is what makes the two durations add up
        const now = new Date();
        const changes: Record<string, unknown> = {};

        const startedField = startedAtField(stage);
        if( !stampOf(workflow, startedField) ) {
            changes[startedField] = now;
        }

        // The immediately previous stage, and only that one. Sealing every stage left open would
        // invent an end for a phase the file may never have entered
        const previousStage = STAGES[STAGES.indexOf(stage) - 1];
        if( previousStage ) {
            const previousStarted = stampOf(workflow, startedAtField(previousStage));
            const previousEnded = stampOf(workflow, endedAtField(previousStage));
            if( previousStarted && !previousEnded ) {
                changes[endedAtField(previousStage)] = now;
            }
        }

        const stageStatus = await resolveStatusItem(STAGE_STATUS[stage], '012', lang, transaction);

        if( workflow.status?.code === STATUS.PENDING_VALIDATION ) {
            // The file keeps waiting for its review, but the point 011 will return it to is now
            // the stage it just entered, not the one it was in when the validation was requested
            changes.previousStatusItemId = stageStatus.catalogItemId;
        } else {
            changes.statusItemId = stageStatus.catalogItemId;
        }

        const newEntry: AppDetails = {
            createdAt: now,
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-CASEFLOW-012',
            detail: `Case workflow advanced to stage ${ stage }`
        };
        const currentAppDetails = ( workflow.appDetails as AppDetails[] | null ) ?? [];

        await workflow.update({
            ...changes,
            appDetails: [...currentAppDetails, newEntry]
        }, { transaction });

        return workflow;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-CASEFLOW-012 - Error advancing case ${ caseId } to stage ${ stage }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(
            getMessage('caseWorkflow.stageCompletedFailed', lang),
            500,
            'CASEFLOW_012_ADVANCE_FAILED',
            error
        );
    }
}

export {
    createCaseWorkflowService,
    getCaseWorkflowsService,
    getAllCaseWorkflowsService,
    getCaseWorkflowByIdService,
    getCaseWorkflowByCaseIdService,
    completeCaseWorkflowStageService,
    closeCaseWorkflowService,
    reopenCaseWorkflowService,
    requestCaseWorkflowValidationService,
    resolveCaseWorkflowValidationService,
    setCaseWorkflowActivationService,
    advanceCaseWorkflowStageService,
    toCaseWorkflowResponse,
    DETAIL_INCLUDE,
    resolveStatusItem,
    startedAtField,
    endedAtField,
    STAGES,
    STAGE_FIELD,
    STAGE_STATUS,
    STATUS,
    STATUS_INCLUDE,
    WORKFLOW_STATUS_CATALOG_CODE
}
