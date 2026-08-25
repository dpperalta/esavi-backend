import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationVaccineAdministered,
    getAllInvestigationVaccinesAdministeredByInvestigation,
    getInvestigationVaccineAdministeredById,
    getInvestigationVaccinesAdministeredByCaseId,
    getInvestigationVaccinesAdministeredByInvestigation,
    updateInvestigationVaccineAdministered
} from '../controllers/investigationVaccineAdministered.controller';
import {
    createInvestigationVaccineAdministeredValidator,
    investigationVaccineAdministeredCaseIdValidator,
    investigationVaccineAdministeredIdValidator,
    investigationVaccineAdministeredInvestigationIdValidator,
    investigationVaccineAdministeredListValidator,
    updateInvestigationVaccineAdministeredValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths —
// /admin/investigation, /investigation, /case, /purge and /activate — go before /:id, or Express
// would capture them as an :id and the UUID validator would answer 400

// Create Investigation Vaccine Administered
// Code: ESAVI-INVVACAD-001
// USER and not ADMIN, following F28 to F36 and the specs before them: the administered vaccine is
// captured in the same operational flow as the case, and splitting the investigation form between
// two roles would break the capture in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationVaccineAdministeredValidator, validateFields, createInvestigationVaccineAdministered);

// Get All Investigation Vaccines Administered By Investigation - For Admin
// Code: ESAVI-INVVACAD-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own letter
// in the five places: they also differ in the minimum role
router.get('/admin/investigation/:id', tokenValidation, validateUserRole(ADMIN), ...investigationVaccineAdministeredInvestigationIdValidator, ...investigationVaccineAdministeredListValidator, validateFields, getAllInvestigationVaccinesAdministeredByInvestigation);

// Get Active Investigation Vaccines Administered By Investigation
// Code: ESAVI-INVVACAD-002A
// The :id is the investigationId and not an administered vaccine id: the listing is entered by the
// foreign key. Declared after /admin/investigation/:id, which is the more specific literal path
router.get('/investigation/:id', tokenValidation, validateUserRole(USER), ...investigationVaccineAdministeredInvestigationIdValidator, ...investigationVaccineAdministeredListValidator, validateFields, getInvestigationVaccinesAdministeredByInvestigation);

// Get Investigation Vaccines Administered By Case ID
// Code: ESAVI-INVVACAD-006
// The only non canonical operation of this entity. USER, like its 002A: the client holds the caseId
// and not the investigationId, so this is the door the operational flow actually uses. Declared with
// the literal paths, before /:id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationVaccineAdministeredCaseIdValidator, ...investigationVaccineAdministeredListValidator, validateFields, getInvestigationVaccinesAdministeredByCaseId);

// Get Investigation Vaccine Administered by ID
// Code: ESAVI-INVVACAD-003
// Declared after every literal path: an /:id first would swallow /admin, /investigation, /case,
// /purge and /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationVaccineAdministeredIdValidator, validateFields, getInvestigationVaccineAdministeredById);

// Update Investigation Vaccine Administered
// Code: ESAVI-INVVACAD-004
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationVaccineAdministeredIdValidator, ...updateInvestigationVaccineAdministeredValidator, validateFields, updateInvestigationVaccineAdministered);

export default router;
