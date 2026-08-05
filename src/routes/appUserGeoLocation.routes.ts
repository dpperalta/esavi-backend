import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createAppUserGeoLocation,
    getAppUserGeoLocationsByUser,
    getAllAppUserGeoLocationsByUser,
    getAppUserGeoLocationById,
    updateAppUserGeoLocation,
    deleteAppUserGeoLocation,
    activateAppUserGeoLocation
} from '../controllers/appUserGeoLocation.controller';
import {
    appUserGeoLocationIdValidator,
    appUserGeoLocationListValidator,
    createAppUserGeoLocationValidator,
    updateAppUserGeoLocationValidator,
    userIdParamValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create App User Geo Location
// Code: ESAVI-USERGEO-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserGeoLocationValidator, validateFields, createAppUserGeoLocation);

// Get App User Geo Locations By User
// Code: ESAVI-USERGEO-002A
router.get('/user/:userId', tokenValidation, validateUserRole(USER), ...userIdParamValidator, ...appUserGeoLocationListValidator, validateFields, getAppUserGeoLocationsByUser);

// Get All App User Geo Locations By User - For Admin
// Code: ESAVI-USERGEO-002B
router.get('/admin/user/:userId', tokenValidation, validateUserRole(ADMIN), ...userIdParamValidator, ...appUserGeoLocationListValidator, validateFields, getAllAppUserGeoLocationsByUser);

// Activate App User Geo Location - For SuperAdmin
// Code: ESAVI-USERGEO-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...appUserGeoLocationIdValidator, validateFields, activateAppUserGeoLocation);

// Get App User Geo Location by ID
// Code: ESAVI-USERGEO-003
// Declared after the literal paths so Express does not capture 'user', 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...appUserGeoLocationIdValidator, validateFields, getAppUserGeoLocationById);

// Update App User Geo Location
// Code: ESAVI-USERGEO-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...appUserGeoLocationIdValidator, ...updateAppUserGeoLocationValidator, validateFields, updateAppUserGeoLocation);

// Soft delete App User Geo Location
// Code: ESAVI-USERGEO-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...appUserGeoLocationIdValidator, validateFields, deleteAppUserGeoLocation);

export default router;
