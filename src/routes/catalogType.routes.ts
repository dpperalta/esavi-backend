import { Router } from 'express';
import { catalogTypeIdValidator, catalogTypeListValidator, createCatalogTypeValidator, updateCatalogTypeValidator } from '../validators';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { activateCatalogType, createCatalogType, deleteCatalogType, getCatalogTypeById, getCatalogTypes, updateCatalogType } from '../controllers/catalogType.controller';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Catalog Type
// Code: ESAVI-CATTYPE-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createCatalogTypeValidator, validateFields, createCatalogType);

// Get Catalog Types
// Code: ESAVI-CATTYPE-002
router.get('/', tokenValidation, validateUserRole(USER), ...catalogTypeListValidator, validateFields, getCatalogTypes);

// Get Catalog Type by ID
// Code: ESAVI-CATTYPE-003
router.get('/:id', tokenValidation, validateUserRole(USER), ...catalogTypeIdValidator, validateFields, getCatalogTypeById);

// Update Catalog Type
// Code: ESAVI-CATTYPE-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogTypeIdValidator, ...updateCatalogTypeValidator, validateFields, updateCatalogType);

// Soft delete Catalog Type
// Code: ESAVI-CATTYPE-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogTypeIdValidator, validateFields, deleteCatalogType);

// Activate Catalog Type
// Code: ESAVI-CATTYPE-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), activateCatalogType);


export default router;