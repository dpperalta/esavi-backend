import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createAppUserGeoLocation,
    getAppUserGeoLocationsByUser,
    getAllAppUserGeoLocationsByUser
} from '../controllers/appUserGeoLocation.controller';
import {
    appUserGeoLocationListValidator,
    createAppUserGeoLocationValidator,
    userIdParamValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

export default router;
