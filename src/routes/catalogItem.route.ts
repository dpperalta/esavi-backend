import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { activateCatalogItem, createCatalogItem, deleteCatalogItem, getAllCatalogItemsByType, getCatalogItemById, getCatalogItemsByType, updateCatalogItem } from '../controllers/catalogItem.controller';
import { catalogItemIdValidator, catalogItemListValidator, createCatalogItemValidator, updateCatalogItemValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Catalog Item
// Code: ESAVI-CATITEM-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createCatalogItemValidator, validateFields, createCatalogItem);

// Get Catalog Items by Catalog Type
// Code: ESAVI-CATITEM-002A
router.get('/type/:id', tokenValidation, validateUserRole(USER), ...catalogItemIdValidator, ...catalogItemListValidator, validateFields, getCatalogItemsByType);

// Get Catalog Items for administration
// Code: ESAVI-CATITEM-002B
router.get('/admin/type/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, ...catalogItemListValidator, validateFields, getAllCatalogItemsByType);

// Get Catalog Item by ID
// Code: ESAVI-CATITEM-002C
router.get('/:id', tokenValidation, validateUserRole(USER), ...catalogItemIdValidator, validateFields, getCatalogItemById);

// Update Catalog Item
// Code: ESAVI-CATITEM-003
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, ...updateCatalogItemValidator, validateFields, updateCatalogItem);

// Soft delete Catalog Item
// Code: ESAVI-CATITEM-004A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, validateFields, deleteCatalogItem);

// Activate Catalog Item
// Code: ESAVI-CATITEM-004B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...catalogItemIdValidator, validateFields, activateCatalogItem);

export default router;
