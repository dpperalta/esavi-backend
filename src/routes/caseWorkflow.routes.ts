import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    getAllCaseWorkflows,
    getCaseWorkflows
} from '../controllers/caseWorkflow.controller';
import { caseWorkflowListValidator } from '../validators';

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

export default router;
