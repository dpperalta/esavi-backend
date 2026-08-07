import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createAppRole,
    getAllAppRoles,
    getAppRoles
} from '../controllers/appRole.controller';
import {
    appRoleListValidator,
    createAppRoleValidator
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

export default router;
