import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigation,
    getAllInvestigations,
    getInvestigationById,
    getInvestigations
} from '../controllers/investigation.controller';
import {
    createInvestigationValidator,
    investigationIdValidator,
    investigationListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

// Get Investigation by ID
// Code: ESAVI-INVESTGN-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationIdValidator, validateFields, getInvestigationById);

export default router;
