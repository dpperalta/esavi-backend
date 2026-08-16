import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createVaccineWhodrug } from '../controllers/vaccineWhodrug.controller';
import { createVaccineWhodrugValidator } from '../validators';

// The only entity of the repository whose base route does not match its table name: the table is
// vaccineWhodrug and the route is /api/whodrug-vaccines. The table reads "WHODrug medicinal product
// of a vaccine"; what the catalog holds are vaccines of the WHODrug dictionary, and that is the
// order an API consumer looks for them in. The file, the model, the types and the service keep the
// table name, because there they have to match the DDL
const { ADMIN } = ROLES;

const router = Router();

// Create Vaccine Whodrug
// Code: ESAVI-WHODRUG-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createVaccineWhodrugValidator, validateFields, createVaccineWhodrug);

export default router;
