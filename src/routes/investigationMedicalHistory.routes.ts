import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationMedicalHistory,
    getAllInvestigationMedicalHistories,
    getInvestigationMedicalHistories,
    getInvestigationMedicalHistoryById
} from '../controllers/investigationMedicalHistory.controller';
import {
    createInvestigationMedicalHistoryValidator,
    investigationMedicalHistoryIdValidator,
    investigationMedicalHistoryListValidator
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

// Get Investigation Medical History by ID
// Code: ESAVI-INVMEDH-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationMedicalHistoryIdValidator, validateFields, getInvestigationMedicalHistoryById);

export default router;
