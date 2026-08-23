import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationMedicalHistory,
    getAllInvestigationMedicalHistories,
    getInvestigationMedicalHistories,
    getInvestigationMedicalHistoryByCaseId,
    getInvestigationMedicalHistoryById,
    updateInvestigationMedicalHistory
} from '../controllers/investigationMedicalHistory.controller';
import {
    createInvestigationMedicalHistoryValidator,
    investigationMedicalHistoryCaseIdValidator,
    investigationMedicalHistoryIdValidator,
    investigationMedicalHistoryListValidator,
    updateInvestigationMedicalHistoryValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Medical History
// Code: ESAVI-INVMEDH-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14, F28, F29, F30 and F31 already fixed: the detail is captured in the same operational
// flow as the case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationMedicalHistoryValidator, validateFields, createInvestigationMedicalHistory);

// Get Investigation Medical Histories
// Code: ESAVI-INVMEDH-002A
// Only the medical histories of active investigations. The entity has no isActive of its own: the
// filter lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationMedicalHistoryListValidator, validateFields, getInvestigationMedicalHistories);

// Get All Investigation Medical Histories - For Admin
// Code: ESAVI-INVMEDH-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the medical
// history of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationMedicalHistoryListValidator, validateFields, getAllInvestigationMedicalHistories);

// Get Investigation Medical History by Case
// Code: ESAVI-INVMEDH-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared before
// /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationMedicalHistoryCaseIdValidator, validateFields, getInvestigationMedicalHistoryByCaseId);

// Get Investigation Medical History by ID
// Code: ESAVI-INVMEDH-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationMedicalHistoryIdValidator, validateFields, getInvestigationMedicalHistoryById);

// Update Investigation Medical History
// Code: ESAVI-INVMEDH-004
// USER for the same reason as 001: completing the anamnesis is part of the same operational flow.
// It is the main operation of the entity — the row is opened with one field and filled in over time
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationMedicalHistoryIdValidator, ...updateInvestigationMedicalHistoryValidator, validateFields, updateInvestigationMedicalHistory);

export default router;
