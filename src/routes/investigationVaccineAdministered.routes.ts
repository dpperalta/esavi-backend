import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationVaccineAdministered,
    getAllInvestigationVaccinesAdministeredByInvestigation,
    getInvestigationVaccinesAdministeredByInvestigation
} from '../controllers/investigationVaccineAdministered.controller';
import {
    createInvestigationVaccineAdministeredValidator,
    investigationVaccineAdministeredInvestigationIdValidator,
    investigationVaccineAdministeredListValidator
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

export default router;
