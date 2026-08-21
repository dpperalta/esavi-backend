import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createInvestigationSource } from '../controllers/investigationSource.controller';
import { createInvestigationSourceValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Investigation Source
// Code: ESAVI-INVSRC-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 already fixed: the detail is captured in the same operational flow as the case,
// and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationSourceValidator, validateFields, createInvestigationSource);

export default router;
