import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    assignAppUserRole,
    getAppUserRolesByUser,
    getAllAppUserRolesByUser,
    getAppUserRoleById,
    getAppUserRolesByRole,
    revokeAppUserRole,
    reinstateAppUserRole,
    bulkAssignRoles
} from '../controllers/appUserRole.controller';
import {
    appUserRoleIdValidator,
    appUserRoleListValidator,
    bulkAssignRolesValidator,
    createAppUserRoleValidator,
    roleIdParamValidator,
    userIdParamValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Assign App User Role
// Code: ESAVI-USERROLE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserRoleValidator, validateFields, assignAppUserRole);

// Bulk Assign Roles
// Code: ESAVI-USERROLE-007
// Declared before /:id so Express does not capture 'bulk' as an :id
router.post('/bulk', tokenValidation, validateUserRole(ADMIN), ...bulkAssignRolesValidator, validateFields, bulkAssignRoles);

// Get App User Roles By User
// Code: ESAVI-USERROLE-002A
router.get('/user/:userId', tokenValidation, validateUserRole(USER), ...userIdParamValidator, ...appUserRoleListValidator, validateFields, getAppUserRolesByUser);

// Get All App User Roles By User - For Admin
// Code: ESAVI-USERROLE-002B
router.get('/admin/user/:userId', tokenValidation, validateUserRole(ADMIN), ...userIdParamValidator, ...appUserRoleListValidator, validateFields, getAllAppUserRolesByUser);

// Get App User Roles By Role - For Admin
// Code: ESAVI-USERROLE-006
// Declared before /:id so Express does not capture 'role' as an :id
router.get('/role/:roleId', tokenValidation, validateUserRole(ADMIN), ...roleIdParamValidator, ...appUserRoleListValidator, validateFields, getAppUserRolesByRole);

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
