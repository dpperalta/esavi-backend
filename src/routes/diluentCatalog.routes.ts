import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createDiluentCatalog } from '../controllers/diluentCatalog.controller';
import { createDiluentCatalogValidator } from '../validators';

// The second entity of the repository whose base route does not match its table name, after
// vaccineWhodrug → /api/whodrug-vaccines: the table is diluentCatalog and the route is /api/diluents.
// What the catalog holds are diluents; 'catalog' names the container, not the resource, and a REST
// resource is named after what it returns. The file, the model, the types and the service keep the
// table name, because there they have to match the DDL
const { ADMIN } = ROLES;

const router = Router();

// Create Diluent Catalog
// Code: ESAVI-DILUENT-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createDiluentCatalogValidator, validateFields, createDiluentCatalog);

export default router;
