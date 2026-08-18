import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateDiluentCatalog,
    createDiluentCatalog,
    deleteDiluentCatalog,
    getAllDiluentCatalogs,
    getDiluentCatalogById,
    getDiluentCatalogs,
    updateDiluentCatalog
} from '../controllers/diluentCatalog.controller';
import {
    createDiluentCatalogValidator,
    diluentCatalogIdValidator,
    diluentCatalogListValidator,
    updateDiluentCatalogValidator
} from '../validators';

// The second entity of the repository whose base route does not match its table name, after
// vaccineWhodrug → /api/whodrug-vaccines: the table is diluentCatalog and the route is /api/diluents.
// What the catalog holds are diluents; 'catalog' names the container, not the resource, and a REST
// resource is named after what it returns. The file, the model, the types and the service keep the
// table name, because there they have to match the DDL
const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Diluent Catalog
// Code: ESAVI-DILUENT-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createDiluentCatalogValidator, validateFields, createDiluentCatalog);

// Get Active Diluent Catalogs
// Code: ESAVI-DILUENT-002A
router.get('/', tokenValidation, validateUserRole(USER), ...diluentCatalogListValidator, validateFields, getDiluentCatalogs);

// Get All Diluent Catalogs - For Admin
// Code: ESAVI-DILUENT-002B
// Literal path, declared before '/:id' so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...diluentCatalogListValidator, validateFields, getAllDiluentCatalogs);

// Activate Diluent Catalog - For SuperAdmin
// Code: ESAVI-DILUENT-005B
// Literal path, declared before '/:id' so Express does not capture 'activate' as an :id
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...diluentCatalogIdValidator, validateFields, activateDiluentCatalog);

// Get Diluent Catalog by ID
// Code: ESAVI-DILUENT-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...diluentCatalogIdValidator, validateFields, getDiluentCatalogById);

// Update Diluent Catalog
// Code: ESAVI-DILUENT-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...diluentCatalogIdValidator, ...updateDiluentCatalogValidator, validateFields, updateDiluentCatalog);

// Soft delete Diluent Catalog
// Code: ESAVI-DILUENT-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...diluentCatalogIdValidator, validateFields, deleteDiluentCatalog);

export default router;
