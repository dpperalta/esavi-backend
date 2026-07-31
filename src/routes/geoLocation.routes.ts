import { Router } from 'express';
import { createGeoLocationValidator, updateGeoLocationValidator } from '../validators';
import { ROLES } from '../constants/roles.constants';
import { tokenValidation, validateUserRole, validateFields } from '../middlewares';
import { activateGeoLocation, createGeoLocation, deleteGeoLocation, getGeoLocationById, getGeoLocations, updateGeoLocation } from '../controllers/geoLocation.controller';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const route = Router();

// Create Geographic Location
// Code: ESAVI-GEOLOC-001
route.post('/', tokenValidation, validateUserRole(ADMIN), ...createGeoLocationValidator, validateFields, createGeoLocation);

// Get Geographic Locations
// Code: ESAVI-GEOLOC-002
route.get('/', tokenValidation, validateUserRole(USER), getGeoLocations);

// Get Geographic Location by ID
// Code: ESAVI-GEOLOC-003
route.get('/:id', tokenValidation, validateUserRole(USER), getGeoLocationById);

// Update Geographic Location
// Code: ESAVI-GEOLOC-004
route.put('/:id', tokenValidation, validateUserRole(ADMIN), updateGeoLocationValidator, validateFields, updateGeoLocation);

// Soft delete Geographic Location
// Code: ESAVI-GEOLOC-005A
route.delete('/:id', tokenValidation, validateUserRole(ADMIN), updateGeoLocationValidator, validateFields, deleteGeoLocation);

// Activate Geographic Location
// Code: ESAVI-GEOLOC-005B
route.patch('/activate/:id', tokenValidation, validateUserRole(ADMIN), updateGeoLocationValidator, validateFields, activateGeoLocation);

export default route;

/*
import { activateGeoLevelType, createGeoLevelType, deleteGeoLevelType, getGeoLevelTypeById, getGeoLevelTypes, updateGeoLevelType } from '../controllers/geoLevelType.controller';
import { createGeoLevelTypeValidator, updateGeoLevelTypeValidator } from '../validators';
import { tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Soft delete Geographic Level Type
// Code: ESAVI-GEOTYPE-005A
router.delete('/:id', tokenValidation, validateUserRole(SUPERADMIN), deleteGeoLevelType);

// Activate Geographic Level Type
// Code: ESAVI-GEOTYPE-005B
router.patch('/:id/activate', tokenValidation, validateUserRole(SUPERADMIN), activateGeoLevelType);

export default router;
*/