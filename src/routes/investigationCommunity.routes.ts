import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationCommunity,
    getAllInvestigationCommunities,
    getInvestigationCommunities,
    getInvestigationCommunityByCaseId,
    getInvestigationCommunityById,
    purgeInvestigationCommunity,
    updateInvestigationCommunity
} from '../controllers/investigationCommunity.controller';
import {
    createInvestigationCommunityValidator,
    investigationCommunityCaseIdValidator,
    investigationCommunityIdValidator,
    investigationCommunityListValidator,
    updateInvestigationCommunityValidator
} from '../validators';

const { ADMIN, SUPERADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Community
// Code: ESAVI-INVCOMM-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 to F39 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationCommunityValidator, validateFields, createInvestigationCommunity);

// Get Investigation Communities
// Code: ESAVI-INVCOMM-002A
// Only the community records of active investigations. The entity has no isActive of its own: the
// filter lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationCommunityListValidator, validateFields, getInvestigationCommunities);

// Get All Investigation Communities - For Admin
// Code: ESAVI-INVCOMM-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the community
// record of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationCommunityListValidator, validateFields, getAllInvestigationCommunities);

// Purge Investigation Community - Physical delete, for SuperAdmin
// Code: ESAVI-INVCOMM-005C
// Declared with the literal paths, before /:id. The entity has no 005A or 005B: it does not have an
// activity flag and does not manage its own state — its investigation does. This is also the only
// operation that releases the investigationId
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...investigationCommunityIdValidator, validateFields, purgeInvestigationCommunity);

// Get Investigation Community by Case
// Code: ESAVI-INVCOMM-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared before
// /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationCommunityCaseIdValidator, validateFields, getInvestigationCommunityByCaseId);

// Get Investigation Community by ID
// Code: ESAVI-INVCOMM-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationCommunityIdValidator, validateFields, getInvestigationCommunityById);

// Update Investigation Community
// Code: ESAVI-INVCOMM-004
// USER for the same reason as 001: completing the community record is part of the same operational
// flow. It is the main operation of the entity — the row is opened with one field and filled in over
// time
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationCommunityIdValidator, ...updateInvestigationCommunityValidator, validateFields, updateInvestigationCommunity);

export default router;
