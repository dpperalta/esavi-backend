import { Router } from 'express';
import { activateGeoLevelType, createGeoLevelType, deleteGeoLevelType, getGeoLevelTypeById, getGeoLevelTypes, updateGeoLevelType } from '../controllers/geoLevelType.controller';
import { createGeoLevelTypeValidator, updateGeoLevelTypeValidator } from '../validators';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Geographic Level Type
// Code: ESAVI-GEOTYPE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createGeoLevelTypeValidator, validateFields, createGeoLevelType);

// Get Geographic Level Types
// Code: ESAVI-GEOTYPE-002
router.get('/', tokenValidation, validateUserRole(USER), getGeoLevelTypes);

// Get Geographic Level Type by ID
// Code: ESAVI-GEOTYPE-003
router.get('/:id', tokenValidation, validateUserRole(USER), getGeoLevelTypeById);

// Update Geographic Level Type
// Code: ESAVI-GEOTYPE-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...updateGeoLevelTypeValidator, validateFields, updateGeoLevelType);

// Soft delete Geographic Level Type
// Code: ESAVI-GEOTYPE-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), deleteGeoLevelType);

// Activate Geographic Level Type
// Code: ESAVI-GEOTYPE-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), activateGeoLevelType);

export default router;