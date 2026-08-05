import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createAppUserGeoLocation } from '../controllers/appUserGeoLocation.controller';
import { createAppUserGeoLocationValidator } from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// Create App User Geo Location
// Code: ESAVI-USERGEO-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createAppUserGeoLocationValidator, validateFields, createAppUserGeoLocation);

export default router;
