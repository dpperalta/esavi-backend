import { Router } from 'express';
import { createUser } from '../controllers/user.controller';
import { createUserValidator } from '../validators';
import { validateFields, tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { ADMIN } = ROLES;

const router = Router();

// Create User
// Code: ESAVI-USER-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createUserValidator, validateFields, createUser);

export default router;
