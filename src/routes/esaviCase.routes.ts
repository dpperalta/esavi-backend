import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createEsaviCase } from '../controllers/esaviCase.controller';
import { createEsaviCaseValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create ESAVI Case
// Code: ESAVI-CASE-001
// USER and not ADMIN, departing from the canonical matrix: whoever opens an ESAVI case is the
// operational staff who has just registered the patient, and with create in ADMIN the flow
// would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createEsaviCaseValidator, validateFields, createEsaviCase);

export default router;
