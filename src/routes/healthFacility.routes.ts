import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createHealthFacility, getHealthFacilitiesByLocation } from '../controllers/healthFacility.controller';
import { createHealthFacilityValidator, geoLocationIdValidator, healthFacilityListValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Health Facility
// Code: ESAVI-HFAC-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createHealthFacilityValidator, validateFields, createHealthFacility);

// Get Active Health Facilities By GeoLocation
// Code: ESAVI-HFAC-002A
router.get('/location/:id', tokenValidation, validateUserRole(USER), ...geoLocationIdValidator, ...healthFacilityListValidator, validateFields, getHealthFacilitiesByLocation);

export default router;