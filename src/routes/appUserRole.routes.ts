import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { assignAppUserRole } from '../controllers/appUserRole.controller';
import { createAppUserRoleValidator } from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// Assign App User Role
// Code: ESAVI-USERROLE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserRoleValidator, validateFields, assignAppUserRole);

export default router;
