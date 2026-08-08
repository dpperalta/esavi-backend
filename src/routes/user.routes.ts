import { Router } from 'express';
import { createUser, getUsers, getAllUsers, getUserById, getOwnProfile, updateUser } from '../controllers/user.controller';
import { createUserValidator, userListValidator, userIdValidator, updateUserValidator } from '../validators';
import { validateFields, tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { ADMIN, USER } = ROLES;

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

// Get Own Profile
// Code: ESAVI-USER-007
router.get('/me', tokenValidation, validateUserRole(USER), getOwnProfile);

// Literal routes are declared above this point: Express would capture them as an :id
// and the UUID validator would answer 400

// Get User By ID
// Code: ESAVI-USER-003
router.get('/:id', tokenValidation, validateUserRole(ADMIN), ...userIdValidator, validateFields, getUserById);

// Update User
// Code: ESAVI-USER-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...userIdValidator, ...updateUserValidator, validateFields, updateUser);

export default router;
