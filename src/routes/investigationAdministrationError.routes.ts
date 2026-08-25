import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createInvestigationAdministrationError } from '../controllers/investigationAdministrationError.controller';
import { createInvestigationAdministrationErrorValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Investigation Administration Error
// Code: ESAVI-INVADMER-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 to F38 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationAdministrationErrorValidator, validateFields, createInvestigationAdministrationError);

export default router;
