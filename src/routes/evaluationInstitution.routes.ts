import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createEvaluationInstitution
} from '../controllers/evaluationInstitution.controller';
import {
    createEvaluationInstitutionValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/investigation, /investigation, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Evaluation Institution
// Code: ESAVI-EVALINST-001
// USER and not ADMIN, following the parent F34 and the specs before it: the institution is captured
// in the same operational flow as the case, and splitting the clinical evaluation form between two
// roles would break the capture in half
router.post('/', tokenValidation, validateUserRole(USER), ...createEvaluationInstitutionValidator, validateFields, createEvaluationInstitution);

export default router;
