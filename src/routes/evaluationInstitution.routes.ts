import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateEvaluationInstitution,
    createEvaluationInstitution,
    deleteEvaluationInstitution,
    getAllEvaluationInstitutionsByInvestigation,
    getEvaluationInstitutionById,
    getEvaluationInstitutionsByInvestigation,
    purgeEvaluationInstitution,
    updateEvaluationInstitution
} from '../controllers/evaluationInstitution.controller';
import {
    createEvaluationInstitutionValidator,
    evaluationInstitutionIdValidator,
    evaluationInstitutionInvestigationIdValidator,
    evaluationInstitutionListValidator,
    updateEvaluationInstitutionValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

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

// Purge Evaluation Institution - Physical delete, for SuperAdmin
// Code: ESAVI-EVALINST-005C
// Declared with the literal paths, before /:id
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...evaluationInstitutionIdValidator, validateFields, purgeEvaluationInstitution);

// Activate Evaluation Institution - For Admin
// Code: ESAVI-EVALINST-005B
// Declared with the literal paths, before /:id. ADMIN and not SUPERADMIN, following F27, F31 and
// F33: it carries a sortOrder reassignment inside a transaction and is case administration, not
// system administration
router.patch('/activate/:id', tokenValidation, validateUserRole(ADMIN), ...evaluationInstitutionIdValidator, validateFields, activateEvaluationInstitution);

// Get Evaluation Institution by ID
// Code: ESAVI-EVALINST-003
// Declared after every literal path: an /:id first would swallow /admin, /investigation, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...evaluationInstitutionIdValidator, validateFields, getEvaluationInstitutionById);

// Update Evaluation Institution
// Code: ESAVI-EVALINST-004
router.put('/:id', tokenValidation, validateUserRole(USER), ...evaluationInstitutionIdValidator, ...updateEvaluationInstitutionValidator, validateFields, updateEvaluationInstitution);

// Delete Evaluation Institution - Soft delete
// Code: ESAVI-EVALINST-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...evaluationInstitutionIdValidator, validateFields, deleteEvaluationInstitution);

export default router;
