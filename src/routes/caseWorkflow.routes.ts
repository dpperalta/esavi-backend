import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateCaseWorkflow,
    closeCaseWorkflow,
    deleteCaseWorkflow,
    completeCaseWorkflowStage,
    getAllCaseWorkflows,
    getCaseWorkflowByCaseId,
    getCaseWorkflowById,
    getCaseWorkflows,
    reopenCaseWorkflow,
    requestCaseWorkflowValidation,
    resolveCaseWorkflowValidation
} from '../controllers/caseWorkflow.controller';
import {
    caseWorkflowCaseIdValidator,
    caseWorkflowIdValidator,
    caseWorkflowListValidator,
    completeCaseWorkflowStageValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// DECLARATION ORDER. The literal paths and the /case/ prefix go BEFORE /:id and /activate/:id.
// Without that order Express captures 'admin' and 'case' as an :id, and caseWorkflowIdValidator
// answers 400 over a UUID nobody sent.
//
// There is no POST: the workflow row is born inside ESAVI-CASE-001, through the internal 001.
// There is no PUT either — the entity has no 004, because no column of the table is written by a
// human — and no DELETE /purge/:id, because caseWorkflow is in preventPhysicalDelete.

// Get Case Workflows
// Code: ESAVI-CASEFLOW-002A
router.get('/', tokenValidation, validateUserRole(USER), ...caseWorkflowListValidator, validateFields, getCaseWorkflows);

// Get All Case Workflows - For Admin
// Code: ESAVI-CASEFLOW-002B
// Declared before /:id so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...caseWorkflowListValidator, validateFields, getAllCaseWorkflows);

// Activate Case Workflow - For SuperAdmin
// Code: ESAVI-CASEFLOW-005B
// Declared before /:id so Express does not capture 'activate' as an :id. It reactivates the
// workflow RECORD; reopening a closed case file is 009
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...caseWorkflowIdValidator, validateFields, activateCaseWorkflow);

// Get Case Workflow by Case
// Code: ESAVI-CASEFLOW-006
// The call a client resumes a file with: status, stamps and the identity of the four stages in a
// single request. Declared before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, validateFields, getCaseWorkflowByCaseId);

// Complete Case Workflow Stage
// Code: ESAVI-CASEFLOW-007
// Seals the end of one stage. It does NOT move the status — that is what 012 does
router.patch('/case/:caseId/complete-stage', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, ...completeCaseWorkflowStageValidator, validateFields, completeCaseWorkflowStage);

// Close Case Workflow
// Code: ESAVI-CASEFLOW-008
// Verifies the four stage preconditions, seals closedAt and moves the status to CLOSED. This is
// how a case file is finished; 005A only retires the workflow RECORD from view
router.patch('/case/:caseId/close', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, validateFields, closeCaseWorkflow);

// Reopen Case Workflow
// Code: ESAVI-CASEFLOW-009
// ADMIN. Increments reopenCount and stamps lastReopenedAt; closedAt is NOT cleared. REOPENED is
// transitory — the next call to 012 takes the file out of it
router.patch('/case/:caseId/reopen', tokenValidation, validateUserRole(ADMIN), ...caseWorkflowCaseIdValidator, validateFields, reopenCaseWorkflow);

// Request Case Workflow Validation
// Code: ESAVI-CASEFLOW-010
// Saves the current status in previousStatusItemId and moves to PENDING_VALIDATION
router.patch('/case/:caseId/request-validation', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, validateFields, requestCaseWorkflowValidation);

// Resolve Case Workflow Validation
// Code: ESAVI-CASEFLOW-011
// Restores previousStatusItemId and clears it. Entering and leaving are two facts, two codes
// and two audit entries — never one endpoint that toggles
router.patch('/case/:caseId/resolve-validation', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, validateFields, resolveCaseWorkflowValidation);

// Get Case Workflow by ID
// Code: ESAVI-CASEFLOW-003
// Declared AFTER every literal path so Express does not capture 'admin' as an :id. The :id is
// the caseWorkflowId, which is why the 006 by case is not redundant with this one
router.get('/:id', tokenValidation, validateUserRole(USER), ...caseWorkflowIdValidator, validateFields, getCaseWorkflowById);

// Soft delete Case Workflow
// Code: ESAVI-CASEFLOW-005A
// Retires the workflow RECORD from view; it does NOT close the case file, which is 008.
// There is no DELETE /purge/:id: caseWorkflow is inside the preventPhysicalDelete loop, so 005C
// is not declared
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...caseWorkflowIdValidator, validateFields, deleteCaseWorkflow);

export default router;
