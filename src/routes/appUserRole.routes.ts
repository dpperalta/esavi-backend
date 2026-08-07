import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    assignAppUserRole,
    getAppUserRolesByUser,
    getAllAppUserRolesByUser,
    getAppUserRoleById,
    revokeAppUserRole,
    reinstateAppUserRole
} from '../controllers/appUserRole.controller';
import {
    appUserRoleIdValidator,
    appUserRoleListValidator,
    createAppUserRoleValidator,
    userIdParamValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

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

// Reinstate App User Role - For SuperAdmin
// Code: ESAVI-USERROLE-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...appUserRoleIdValidator, validateFields, reinstateAppUserRole);

// Get App User Role by ID
// Code: ESAVI-USERROLE-003
// Declared after the literal paths so Express does not capture 'bulk', 'user', 'admin', 'role' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...appUserRoleIdValidator, validateFields, getAppUserRoleById);

// Revoke App User Role
// Code: ESAVI-USERROLE-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...appUserRoleIdValidator, validateFields, revokeAppUserRole);

export default router;
