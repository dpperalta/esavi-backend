import { Router } from 'express';
import { createGeoLocationValidator, generateGeoTemplateValidator, geoLocationIdValidator, geoLocationListValidator, importGeoDataValidator, updateGeoLocationValidator } from '../validators';
import { ROLES } from '../constants/roles.constants';
import { tokenValidation, uploadSingleFile, validateUserRole, validateFields } from '../middlewares';
import { activateGeoLocation, createGeoLocation, deleteGeoLocation, generateGeoTemplate, getGeoLocationById, getGeoLocations, importGeoData, updateGeoLocation } from '../controllers/geoLocation.controller';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Geographic Location
// Code: ESAVI-GEOLOC-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createGeoLocationValidator, validateFields, createGeoLocation);

// Get Geographic Locations
// Code: ESAVI-GEOLOC-002
router.get('/', tokenValidation, validateUserRole(USER), ...geoLocationListValidator, validateFields, getGeoLocations);

// Bulk import of geography and health facilities
// Code: ESAVI-GEOLOC-006
// Declared BEFORE the routes carrying :id, for the same reason as the template below
router.post('/import', tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'geoLocation', codePrefix: 'GEOLOC_006' }), ...importGeoDataValidator, validateFields, importGeoData);

// Generate the import template
// Code: ESAVI-GEOLOC-007
// Declared BEFORE GET /:id: Express would otherwise capture 'import' as an :id and the UUID
// validator would answer 400
router.get('/import/template', tokenValidation, validateUserRole(ADMIN), ...generateGeoTemplateValidator, validateFields, generateGeoTemplate);

// Get Geographic Location by ID
// Code: ESAVI-GEOLOC-003
router.get('/:id', tokenValidation, validateUserRole(USER), ...geoLocationIdValidator, validateFields, getGeoLocationById);

// Update Geographic Location
// Code: ESAVI-GEOLOC-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...geoLocationIdValidator, ...updateGeoLocationValidator, validateFields, updateGeoLocation);

// Soft delete Geographic Location
// Code: ESAVI-GEOLOC-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...geoLocationIdValidator, validateFields, deleteGeoLocation);

// Activate Geographic Location
// Code: ESAVI-GEOLOC-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...geoLocationIdValidator, validateFields, activateGeoLocation);

export default router;