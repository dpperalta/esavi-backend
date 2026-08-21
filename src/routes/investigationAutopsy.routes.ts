import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationAutopsy,
    getAllInvestigationAutopsies,
    getInvestigationAutopsies
} from '../controllers/investigationAutopsy.controller';
import {
    createInvestigationAutopsyValidator,
    investigationAutopsyListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Autopsy
// Code: ESAVI-INVAUT-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14, F28 and F29 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationAutopsyValidator, validateFields, createInvestigationAutopsy);

// Get Investigation Autopsies
// Code: ESAVI-INVAUT-002A
// Only the autopsies of active investigations. The entity has no isActive of its own: the filter
// lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationAutopsyListValidator, validateFields, getInvestigationAutopsies);

// Get All Investigation Autopsies - For Admin
// Code: ESAVI-INVAUT-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the autopsy of
// a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationAutopsyListValidator, validateFields, getAllInvestigationAutopsies);

export default router;
