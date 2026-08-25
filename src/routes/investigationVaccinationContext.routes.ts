import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationVaccinationContext,
    getAllInvestigationVaccinationContexts,
    getInvestigationVaccinationContexts
} from '../controllers/investigationVaccinationContext.controller';
import {
    createInvestigationVaccinationContextValidator,
    investigationVaccinationContextListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Vaccination Context
// Code: ESAVI-INVVACTX-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 to F35 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationVaccinationContextValidator, validateFields, createInvestigationVaccinationContext);

// Get Investigation Vaccination Contexts
// Code: ESAVI-INVVACTX-002A
// Only the contexts of active investigations. The entity has no isActive of its own: the filter
// lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationVaccinationContextListValidator, validateFields, getInvestigationVaccinationContexts);

// Get All Investigation Vaccination Contexts - For Admin
// Code: ESAVI-INVVACTX-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the vaccination
// context of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationVaccinationContextListValidator, validateFields, getAllInvestigationVaccinationContexts);

export default router;
