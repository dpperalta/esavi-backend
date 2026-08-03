import { Router } from 'express';
import { createGeoLocationValidator, geoLocationIdValidator, geoLocationListValidator, updateGeoLocationValidator } from '../validators';
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
route.get('/', tokenValidation, validateUserRole(USER), ...geoLocationListValidator, validateFields, getGeoLocations);

// Get Geographic Location by ID
// Code: ESAVI-GEOLOC-003
route.get('/:id', tokenValidation, validateUserRole(USER), ...geoLocationIdValidator, validateFields, getGeoLocationById);

// Update Geographic Location
// Code: ESAVI-GEOLOC-004
route.put('/:id', tokenValidation, validateUserRole(ADMIN), ...geoLocationIdValidator, ...updateGeoLocationValidator, validateFields, updateGeoLocation);

// Soft delete Geographic Location
// Code: ESAVI-GEOLOC-005A
route.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...geoLocationIdValidator, validateFields, deleteGeoLocation);

// Activate Geographic Location
// Code: ESAVI-GEOLOC-005B
route.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...geoLocationIdValidator, validateFields, activateGeoLocation);

export default route;