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
    activateAppUserGeoLocation,
    purgeAppUserGeoLocation,
    reassignAppUserGeoLocation,
    bulkAssignGeoLocations,
    getUserCoverage
} from '../controllers/appUserGeoLocation.controller';
import {
    appUserGeoLocationIdValidator,
    appUserGeoLocationListValidator,
    bulkAssignValidator,
    createAppUserGeoLocationValidator,
    reassignValidator,
    updateAppUserGeoLocationValidator,
    userIdParamValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create App User Geo Location
// Code: ESAVI-USERGEO-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserGeoLocationValidator, validateFields, createAppUserGeoLocation);

// Bulk Assign Geo Locations
// Code: ESAVI-USERGEO-007
// Declared before /:id so Express does not capture 'bulk' as an :id
router.post('/bulk', tokenValidation, validateUserRole(ADMIN), ...bulkAssignValidator, validateFields, bulkAssignGeoLocations);

// Get User Coverage
// Code: ESAVI-USERGEO-008
// Declared before /user/:userId, which would otherwise swallow the /coverage suffix
router.get('/user/:userId/coverage', tokenValidation, validateUserRole(USER), ...userIdParamValidator, validateFields, getUserCoverage);

// Get App User Geo Locations By User
// Code: ESAVI-USERGEO-002A
router.get('/user/:userId', tokenValidation, validateUserRole(USER), ...userIdParamValidator, ...appUserGeoLocationListValidator, validateFields, getAppUserGeoLocationsByUser);

// Get All App User Geo Locations By User - For Admin
// Code: ESAVI-USERGEO-002B
router.get('/admin/user/:userId', tokenValidation, validateUserRole(ADMIN), ...userIdParamValidator, ...appUserGeoLocationListValidator, validateFields, getAllAppUserGeoLocationsByUser);

// Reassign App User Geo Location
// Code: ESAVI-USERGEO-006
router.patch('/reassign/:id', tokenValidation, validateUserRole(ADMIN), ...appUserGeoLocationIdValidator, ...reassignValidator, validateFields, reassignAppUserGeoLocation);

// Activate App User Geo Location - For SuperAdmin
// Code: ESAVI-USERGEO-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...appUserGeoLocationIdValidator, validateFields, activateAppUserGeoLocation);

// Purge App User Geo Location - For SuperAdmin
// Code: ESAVI-USERGEO-005C
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...appUserGeoLocationIdValidator, validateFields, purgeAppUserGeoLocation);

// Get App User Geo Location by ID
// Code: ESAVI-USERGEO-003
// Declared after the literal paths so Express does not capture 'bulk', 'user', 'admin', 'reassign' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...appUserGeoLocationIdValidator, validateFields, getAppUserGeoLocationById);

// Update App User Geo Location
// Code: ESAVI-USERGEO-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...appUserGeoLocationIdValidator, ...updateAppUserGeoLocationValidator, validateFields, updateAppUserGeoLocation);

// Soft delete App User Geo Location
// Code: ESAVI-USERGEO-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...appUserGeoLocationIdValidator, validateFields, deleteAppUserGeoLocation);

export default router;
