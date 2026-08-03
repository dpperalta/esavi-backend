import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateHealthFacility,
    createHealthFacility,
    deleteHealthFacility,
    getAllHealthFacilitiesByLocation,
    getHealthFacilitiesByLocation,
    getHealthFacilityById,
    updateHealthFacility
} from '../controllers/healthFacility.controller';
import { createHealthFacilityValidator, geoLocationIdValidator, healthFacilityIdValidator, healthFacilityListValidator, updateHealthFacilityValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Health Facility
// Code: ESAVI-HFAC-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createHealthFacilityValidator, validateFields, createHealthFacility);

// Get Active Health Facilities By GeoLocation
// Code: ESAVI-HFAC-002A
router.get('/location/:id', tokenValidation, validateUserRole(USER), ...geoLocationIdValidator, ...healthFacilityListValidator, validateFields, getHealthFacilitiesByLocation);

// Get All Health Facilities By GeoLocation - For Admin
// Code: ESAVI-HFAC-002B
router.get('/admin/location/:id', tokenValidation, validateUserRole(ADMIN), ...geoLocationIdValidator, ...healthFacilityListValidator, validateFields, getAllHealthFacilitiesByLocation);

// Activate Health Facility - For SuperAdmin
// Code: ESAVI-HFAC-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...healthFacilityIdValidator, validateFields, activateHealthFacility);

// Get Health Facility by ID
// Code: ESAVI-HFAC-003
// Declared after the literal paths so Express does not capture 'location', 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...healthFacilityIdValidator, validateFields, getHealthFacilityById);

// Update Health Facility
// Code: ESAVI-HFAC-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...healthFacilityIdValidator, ...updateHealthFacilityValidator, validateFields, updateHealthFacility);

// Soft delete Health Facility
// Code: ESAVI-HFAC-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...healthFacilityIdValidator, validateFields, deleteHealthFacility);

export default router;