import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    getAllCaseWorkflows,
    getCaseWorkflowByCaseId,
    getCaseWorkflowById,
    getCaseWorkflows
} from '../controllers/caseWorkflow.controller';
import { caseWorkflowCaseIdValidator, caseWorkflowIdValidator, caseWorkflowListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

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

// Get Case Workflow by Case
// Code: ESAVI-CASEFLOW-006
// The call a client resumes a file with: status, stamps and the identity of the four stages in a
// single request. Declared before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...caseWorkflowCaseIdValidator, validateFields, getCaseWorkflowByCaseId);

// Get Case Workflow by ID
// Code: ESAVI-CASEFLOW-003
// Declared AFTER every literal path so Express does not capture 'admin' as an :id. The :id is
// the caseWorkflowId, which is why the 006 by case is not redundant with this one
router.get('/:id', tokenValidation, validateUserRole(USER), ...caseWorkflowIdValidator, validateFields, getCaseWorkflowById);

export default router;
