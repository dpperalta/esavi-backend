import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createVaccineWhodrug, getAllVaccineWhodrugs, getVaccineWhodrugById, getVaccineWhodrugs } from '../controllers/vaccineWhodrug.controller';
import { createVaccineWhodrugValidator, vaccineWhodrugIdValidator, vaccineWhodrugListValidator } from '../validators';

// The only entity of the repository whose base route does not match its table name: the table is
// vaccineWhodrug and the route is /api/whodrug-vaccines. The table reads "WHODrug medicinal product
// of a vaccine"; what the catalog holds are vaccines of the WHODrug dictionary, and that is the
// order an API consumer looks for them in. The file, the model, the types and the service keep the
// table name, because there they have to match the DDL
const { ADMIN, USER } = ROLES;

const router = Router();

// Create Vaccine Whodrug
// Code: ESAVI-WHODRUG-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createVaccineWhodrugValidator, validateFields, createVaccineWhodrug);

// Get Active Vaccine Whodrugs
// Code: ESAVI-WHODRUG-002A
router.get('/', tokenValidation, validateUserRole(USER), ...vaccineWhodrugListValidator, validateFields, getVaccineWhodrugs);

// Get All Vaccine Whodrugs - For Admin
// Code: ESAVI-WHODRUG-002B
// Literal path, declared before '/:id' so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...vaccineWhodrugListValidator, validateFields, getAllVaccineWhodrugs);

// Get Vaccine Whodrug by ID
// Code: ESAVI-WHODRUG-003
// Declared after the literal paths so Express does not capture 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...vaccineWhodrugIdValidator, validateFields, getVaccineWhodrugById);

export default router;
