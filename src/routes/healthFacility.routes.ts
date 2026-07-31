import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createHealthFacility, getHealthFacilitiesByLocation } from '../controllers/healthFacility.controller';
import { createHealthFacilityValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Health Facility
// Code: ESAVI-HF-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createHealthFacilityValidator, validateFields, createHealthFacility);

// Get health facilities of a given geoLocationId with pagination and option to include inactive (for admin users)
// Code: ESAVI-HF-002A
router.get('/location/:id', tokenValidation, validateUserRole(USER), getHealthFacilitiesByLocation);

export default router;