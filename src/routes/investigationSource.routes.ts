import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationSource,
    getAllInvestigationSources,
    getInvestigationSources
} from '../controllers/investigationSource.controller';
import {
    createInvestigationSourceValidator,
    investigationSourceListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Source
// Code: ESAVI-INVSRC-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 already fixed: the detail is captured in the same operational flow as the case,
// and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationSourceValidator, validateFields, createInvestigationSource);

// Get Investigation Sources
// Code: ESAVI-INVSRC-002A
// Only the sources of active investigations. The entity has no isActive of its own: the filter
// lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationSourceListValidator, validateFields, getInvestigationSources);

// Get All Investigation Sources - For Admin
// Code: ESAVI-INVSRC-002B
// Declared with the literal paths, before /:id. This is the variant F13 and F14 did not have: an
// ADMIN needs some way of reaching the source of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationSourceListValidator, validateFields, getAllInvestigationSources);

export default router;
