import { Transaction } from 'sequelize';

import { CaseWorkflow, CatalogItem, CatalogType } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { AppDetails, AuthUser, CreateCaseWorkflowInput } from '../types';

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

export {
    createCaseWorkflowService,
    resolveStatusItem,
    STATUS,
    WORKFLOW_STATUS_CATALOG_CODE
}
