import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createAppRole } from '../controllers/appRole.controller';
import { createAppRoleValidator } from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// Create App Role
// Code: ESAVI-APPROLE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppRoleValidator, validateFields, createAppRole);

export default router;
