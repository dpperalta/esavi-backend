import { Transaction } from 'sequelize';

import { CaseWorkflow, CatalogItem, CatalogType } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { AppDetails, AuthUser, CaseWorkflowStage, CreateCaseWorkflowInput } from '../types';

/**
 * caseWorkflow — administrative progress of the case file (SPEC F44).
 *
 * The status this file moves is NOT the clinical outcome of the patient: that one lives in
 * `investigation.statusItemId`, over the `investigationStatus` catalog. The two are orthogonal —
 * a closed file can belong to a patient who never recovered, and a recovered patient can have an
 * open file.
 *
 * NO WRITE HERE IS A DIFFERENTIAL UPDATE — `buildDifferentialUpdate` of CONVENTIONS.md §11 is
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
    advanceCaseWorkflowStageService,
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
