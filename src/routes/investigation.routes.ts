import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateInvestigation,
    createInvestigation,
    deleteInvestigation,
    getAllInvestigations,
    getInvestigationByCaseId,
    getInvestigationById,
    getInvestigations,
    purgeInvestigation,
    updateInvestigation
} from '../controllers/investigation.controller';
import {
    createInvestigationValidator,
    investigationCaseIdValidator,
    investigationIdValidator,
    investigationListValidator,
    updateInvestigationValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation
// Code: ESAVI-INVESTGN-001
// USER and not ADMIN, departing from the canonical matrix: the investigation is captured in the
// same operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationValidator, validateFields, createInvestigation);

// Get Investigations
// Code: ESAVI-INVESTGN-002A
router.get('/', tokenValidation, validateUserRole(USER), ...investigationListValidator, validateFields, getInvestigations);

// Get All Investigations - For Admin
// Code: ESAVI-INVESTGN-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationListValidator, validateFields, getAllInvestigations);

// Activate Investigation - For SuperAdmin
// Code: ESAVI-INVESTGN-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...investigationIdValidator, validateFields, activateInvestigation);

// Purge Investigation - Physical delete, for SuperAdmin
// Code: ESAVI-INVESTGN-005C
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...investigationIdValidator, validateFields, purgeInvestigation);

// Get Investigation by Case
// Code: ESAVI-INVESTGN-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationCaseIdValidator, validateFields, getInvestigationByCaseId);

// Get Investigation by ID
// Code: ESAVI-INVESTGN-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationIdValidator, validateFields, getInvestigationById);

// Update Investigation
// Code: ESAVI-INVESTGN-004
// USER for the same reason as 001: completing the investigation is part of the same clinical flow
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationIdValidator, ...updateInvestigationValidator, validateFields, updateInvestigation);

// Soft delete Investigation
// Code: ESAVI-INVESTGN-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...investigationIdValidator, validateFields, deleteInvestigation);

export default router;
