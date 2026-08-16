import { Router } from 'express';
import { tokenValidation, uploadSingleFile, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { activateCatalogItem, createCatalogItem, deleteCatalogItem, getAllCatalogItemsByType, getCatalogItemById, getCatalogItemsByType, importCatalogItems, updateCatalogItem } from '../controllers/catalogItem.controller';
import { catalogItemIdValidator, catalogItemListValidator, createCatalogItemValidator, importCatalogItemsValidator, updateCatalogItemValidator } from '../validators';

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

// Import Catalog Items
// Literal path, declared before '/:id' so that '/import' is never read as an identifier.
// uploadSingleFile is parameterized per entity, so this route reuses the middleware F19 left
// generalized without touching it: the i18nPrefix resolves the five keys of the catalogItem block
// Code: ESAVI-CATITEM-006
router.post('/import', tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'catalogItem', codePrefix: 'CATITEM_006' }), ...importCatalogItemsValidator, validateFields, importCatalogItems);

// Get Catalog Item by ID
// Code: ESAVI-CATITEM-003
router.get('/:id', tokenValidation, validateUserRole(USER), ...catalogItemIdValidator, validateFields, getCatalogItemById);

// Update Catalog Item
// Code: ESAVI-CATITEM-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, ...updateCatalogItemValidator, validateFields, updateCatalogItem);

// Soft delete Catalog Item
// Code: ESAVI-CATITEM-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...catalogItemIdValidator, validateFields, deleteCatalogItem);

// Activate Catalog Item
// Code: ESAVI-CATITEM-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...catalogItemIdValidator, validateFields, activateCatalogItem);

export default router;
