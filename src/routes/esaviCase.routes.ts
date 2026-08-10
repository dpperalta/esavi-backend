import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateEsaviCase,
    createEsaviCase,
    deleteEsaviCase,
    getAllEsaviCases,
    getEsaviCaseById,
    getEsaviCases,
    updateEsaviCase
} from '../controllers/esaviCase.controller';
import { createEsaviCaseValidator, esaviCaseIdValidator, esaviCaseListValidator, updateEsaviCaseValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create ESAVI Case
// Code: ESAVI-CASE-001
// USER and not ADMIN, departing from the canonical matrix: whoever opens an ESAVI case is the
// operational staff who has just registered the patient, and with create in ADMIN the flow
// would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createEsaviCaseValidator, validateFields, createEsaviCase);

// Get ESAVI Cases
// Code: ESAVI-CASE-002A
router.get('/', tokenValidation, validateUserRole(USER), ...esaviCaseListValidator, validateFields, getEsaviCases);

// Get All ESAVI Cases - For Admin
// Code: ESAVI-CASE-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...esaviCaseListValidator, validateFields, getAllEsaviCases);

// Activate ESAVI Case - For SuperAdmin
// Code: ESAVI-CASE-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...esaviCaseIdValidator, validateFields, activateEsaviCase);

// Get ESAVI Case by ID
// Code: ESAVI-CASE-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...esaviCaseIdValidator, validateFields, getEsaviCaseById);

// Update ESAVI Case
// Code: ESAVI-CASE-004
// USER for the same reason as 001: correcting the case is part of reporting the ESAVI
router.put('/:id', tokenValidation, validateUserRole(USER), ...esaviCaseIdValidator, ...updateEsaviCaseValidator, validateFields, updateEsaviCase);

// Soft delete ESAVI Case
// Code: ESAVI-CASE-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...esaviCaseIdValidator, validateFields, deleteEsaviCase);

export default router;
