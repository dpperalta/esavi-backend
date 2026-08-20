import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createInvestigation } from '../controllers/investigation.controller';
import { createInvestigationValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Investigation
// Code: ESAVI-INVESTGN-001
// USER and not ADMIN, departing from the canonical matrix: the investigation is captured in the
// same operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationValidator, validateFields, createInvestigation);

export default router;
