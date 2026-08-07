import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    assignAppUserRole,
    getAppUserRolesByUser,
    getAllAppUserRolesByUser,
    getAppUserRoleById
} from '../controllers/appUserRole.controller';
import {
    appUserRoleIdValidator,
    appUserRoleListValidator,
    createAppUserRoleValidator,
    userIdParamValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Assign App User Role
// Code: ESAVI-USERROLE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserRoleValidator, validateFields, assignAppUserRole);

// Get App User Roles By User
// Code: ESAVI-USERROLE-002A
router.get('/user/:userId', tokenValidation, validateUserRole(USER), ...userIdParamValidator, ...appUserRoleListValidator, validateFields, getAppUserRolesByUser);

// Get All App User Roles By User - For Admin
// Code: ESAVI-USERROLE-002B
router.get('/admin/user/:userId', tokenValidation, validateUserRole(ADMIN), ...userIdParamValidator, ...appUserRoleListValidator, validateFields, getAllAppUserRolesByUser);

// Get App User Role by ID
// Code: ESAVI-USERROLE-003
// Declared after the literal paths so Express does not capture 'bulk', 'user', 'admin', 'role' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...appUserRoleIdValidator, validateFields, getAppUserRoleById);

export default router;
