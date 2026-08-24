import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createEvaluationInstitution,
    getAllEvaluationInstitutionsByInvestigation,
    getEvaluationInstitutionById,
    getEvaluationInstitutionsByInvestigation
} from '../controllers/evaluationInstitution.controller';
import {
    createEvaluationInstitutionValidator,
    evaluationInstitutionIdValidator,
    evaluationInstitutionInvestigationIdValidator,
    evaluationInstitutionListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

// Get All Evaluation Institutions By Investigation - For Admin
// Code: ESAVI-EVALINST-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own letter
// in the five places: they also differ in the minimum role
router.get('/admin/investigation/:id', tokenValidation, validateUserRole(ADMIN), ...evaluationInstitutionInvestigationIdValidator, ...evaluationInstitutionListValidator, validateFields, getAllEvaluationInstitutionsByInvestigation);

// Get Active Evaluation Institutions By Investigation
// Code: ESAVI-EVALINST-002A
// The :id is the investigationId — which names the clinical evaluation, not the investigation — and
// not an institution id: the listing is entered by the foreign key. Declared after
// /admin/investigation/:id, which is the more specific literal path
router.get('/investigation/:id', tokenValidation, validateUserRole(USER), ...evaluationInstitutionInvestigationIdValidator, ...evaluationInstitutionListValidator, validateFields, getEvaluationInstitutionsByInvestigation);

// Get Evaluation Institution by ID
// Code: ESAVI-EVALINST-003
// Declared after every literal path: an /:id first would swallow /admin, /investigation, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...evaluationInstitutionIdValidator, validateFields, getEvaluationInstitutionById);

export default router;
