import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationAdministrationError,
    getAllInvestigationAdministrationErrors,
    getInvestigationAdministrationErrorById,
    getInvestigationAdministrationErrors
} from '../controllers/investigationAdministrationError.controller';
import {
    createInvestigationAdministrationErrorValidator,
    investigationAdministrationErrorIdValidator,
    investigationAdministrationErrorListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Administration Error
// Code: ESAVI-INVADMER-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 to F38 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationAdministrationErrorValidator, validateFields, createInvestigationAdministrationError);

// Get Investigation Administration Errors
// Code: ESAVI-INVADMER-002A
// Only the administration errors of active investigations. The entity has no isActive of its own:
// the filter lands on the where of the investigation include, which is the real source of its
// visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationAdministrationErrorListValidator, validateFields, getInvestigationAdministrationErrors);

// Get All Investigation Administration Errors - For Admin
// Code: ESAVI-INVADMER-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the
// administration error of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationAdministrationErrorListValidator, validateFields, getAllInvestigationAdministrationErrors);

// Get Investigation Administration Error by ID
// Code: ESAVI-INVADMER-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationAdministrationErrorIdValidator, validateFields, getInvestigationAdministrationErrorById);

export default router;
