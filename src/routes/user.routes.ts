import { Router } from 'express';
import { createUser, getUsers, getAllUsers } from '../controllers/user.controller';
import { createUserValidator, userListValidator } from '../validators';
import { validateFields, tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { ADMIN } = ROLES;

const router = Router();

// Create User
// Code: ESAVI-USER-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createUserValidator, validateFields, createUser);

// Get Active Users
// Code: ESAVI-USER-002A
router.get('/', tokenValidation, validateUserRole(ADMIN), ...userListValidator, validateFields, getUsers);

// Get All Users - For Admin
// Code: ESAVI-USER-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...userListValidator, validateFields, getAllUsers);

export default router;
