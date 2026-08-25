import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationVaccineAdministered
} from '../controllers/investigationVaccineAdministered.controller';
import {
    createInvestigationVaccineAdministeredValidator
} from '../validators';

const { USER } = ROLES;

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

export default router;
