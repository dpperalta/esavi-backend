import { Router } from 'express';
import { tokenValidation, uploadSingleFile, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateVaccineWhodrug,
    createVaccineWhodrug,
    deleteVaccineWhodrug,
    getAllVaccineWhodrugs,
    getVaccineWhodrugById,
    getVaccineWhodrugs,
    getWhodrugAbbreviations,
    getWhodrugDrugNames,
    getWhodrugForms,
    getWhodrugMaHolders,
    getWhodrugStrengths,
    importVaccineWhodrugs,
    updateVaccineWhodrug
} from '../controllers/vaccineWhodrug.controller';
import {
    createVaccineWhodrugValidator,
    importVaccineWhodrugsValidator,
    updateVaccineWhodrugValidator,
    vaccineWhodrugIdValidator,
    vaccineWhodrugListValidator,
    whodrugAbbreviationsValidator,
    whodrugDrugNamesValidator,
    whodrugFormsValidator,
    whodrugMaHoldersValidator,
    whodrugStrengthsValidator
} from '../validators';

// The only entity of the repository whose base route does not match its table name: the table is
// vaccineWhodrug and the route is /api/whodrug-vaccines. The table reads "WHODrug medicinal product
// of a vaccine"; what the catalog holds are vaccines of the WHODrug dictionary, and that is the
// order an API consumer looks for them in. The file, the model, the types and the service keep the
// table name, because there they have to match the DDL
const { SUPERADMIN, ADMIN, USER } = ROLES;

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

// Activate Vaccine Whodrug - For SuperAdmin
// Code: ESAVI-WHODRUG-005B
// Literal path, declared before '/:id' so Express does not capture 'activate' as an :id
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...vaccineWhodrugIdValidator, validateFields, activateVaccineWhodrug);

// Import Vaccine Whodrugs from a WHODrug .xlsx file - For SuperAdmin
// Code: ESAVI-WHODRUG-007
// Literal path, declared before '/:id' for coherence with the rest of the file. uploadSingleFile
// runs before the validators because the multipart body does not exist until multer parses it
router.post('/import', tokenValidation, validateUserRole(SUPERADMIN), uploadSingleFile('file', { i18nPrefix: 'vaccineWhodrug', codePrefix: 'WHODRUG_007' }), ...importVaccineWhodrugsValidator, validateFields, importVaccineWhodrugs);

// SPEC F54 — the five levels of the WHODrug tree: abbreviation → drugName → maHolders →
// formTranslations → strength. All literal paths, all declared before '/:id' so Express does not
// capture 'abbreviations' as an :id and answer 400 from the UUID validator instead of listing.
// Every option carries its own matchCount, and the vaccineWhodrugId resolved when that count is 1:
// the sixth endpoint the tree needs — the full row by its id — is ESAVI-WHODRUG-003, already below

// Get WHODrug Abbreviations
// Code: ESAVI-WHODRUG-006A
router.get('/abbreviations', tokenValidation, validateUserRole(USER), ...whodrugAbbreviationsValidator, validateFields, getWhodrugAbbreviations);

// Get WHODrug Drug Names
// Code: ESAVI-WHODRUG-006B
router.get('/drug-names', tokenValidation, validateUserRole(USER), ...whodrugDrugNamesValidator, validateFields, getWhodrugDrugNames);

// Get WHODrug MA Holders
// Code: ESAVI-WHODRUG-006C
router.get('/ma-holders', tokenValidation, validateUserRole(USER), ...whodrugMaHoldersValidator, validateFields, getWhodrugMaHolders);

// Get WHODrug Forms
// Code: ESAVI-WHODRUG-006D
router.get('/forms', tokenValidation, validateUserRole(USER), ...whodrugFormsValidator, validateFields, getWhodrugForms);

// Get WHODrug Strengths
// Code: ESAVI-WHODRUG-006E
router.get('/strengths', tokenValidation, validateUserRole(USER), ...whodrugStrengthsValidator, validateFields, getWhodrugStrengths);

// Get Vaccine Whodrug by ID
// Code: ESAVI-WHODRUG-003
// Declared after the literal paths so Express does not capture 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...vaccineWhodrugIdValidator, validateFields, getVaccineWhodrugById);

// Update Vaccine Whodrug
// Code: ESAVI-WHODRUG-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...vaccineWhodrugIdValidator, ...updateVaccineWhodrugValidator, validateFields, updateVaccineWhodrug);

// Soft delete Vaccine Whodrug
// Code: ESAVI-WHODRUG-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...vaccineWhodrugIdValidator, validateFields, deleteVaccineWhodrug);

export default router;
