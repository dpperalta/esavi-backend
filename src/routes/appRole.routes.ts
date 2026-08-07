import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createAppRole,
    getAllAppRoles,
    getAppRoleById,
    getAppRoles,
    updateAppRole
} from '../controllers/appRole.controller';
import {
    appRoleIdValidator,
    appRoleListValidator,
    createAppRoleValidator,
    updateAppRoleValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create App Role
// Code: ESAVI-APPROLE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppRoleValidator, validateFields, createAppRole);

// Get App Roles
// Code: ESAVI-APPROLE-002A
router.get('/', tokenValidation, validateUserRole(USER), ...appRoleListValidator, validateFields, getAppRoles);

// Get All App Roles - For Admin
// Code: ESAVI-APPROLE-002B
// Declared before /:id so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...appRoleListValidator, validateFields, getAllAppRoles);

// Get App Role by ID
// Code: ESAVI-APPROLE-003
// Declared after the literal paths so Express does not capture 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...appRoleIdValidator, validateFields, getAppRoleById);

// Update App Role
// Code: ESAVI-APPROLE-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...appRoleIdValidator, ...updateAppRoleValidator, validateFields, updateAppRole);

export default router;
