import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationClinicalEvaluation,
    getAllInvestigationClinicalEvaluations,
    getInvestigationClinicalEvaluations
} from '../controllers/investigationClinicalEvaluation.controller';
import {
    createInvestigationClinicalEvaluationValidator,
    investigationClinicalEvaluationListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Clinical Evaluation
// Code: ESAVI-INVCLIEV-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14, F28, F29, F30, F31, F32 and F33 already fixed: the detail is captured in the same
// operational flow as the case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationClinicalEvaluationValidator, validateFields, createInvestigationClinicalEvaluation);

// Get Investigation Clinical Evaluations
// Code: ESAVI-INVCLIEV-002A
// Only the clinical evaluations of active investigations. The entity has no isActive of its own: the
// filter lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationClinicalEvaluationListValidator, validateFields, getInvestigationClinicalEvaluations);

// Get All Investigation Clinical Evaluations - For Admin
// Code: ESAVI-INVCLIEV-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the clinical
// evaluation of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationClinicalEvaluationListValidator, validateFields, getAllInvestigationClinicalEvaluations);

export default router;
