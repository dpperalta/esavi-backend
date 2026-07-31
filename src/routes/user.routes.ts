import { Router } from 'express';
import { createUser } from '../controllers/user.controller';
import { createUserValidator } from '../validators';
import { validateFields, tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { SUPERADMIN } = ROLES;

const router = Router();

// POST /api/users - Create a new user (SUPERADMIN only)
router.post('/', tokenValidation, validateUserRole(SUPERADMIN), ...createUserValidator, validateFields, createUser);

export default router;