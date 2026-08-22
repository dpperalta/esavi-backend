import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationTeamMember,
    getAllInvestigationTeamMembersByInvestigation,
    getInvestigationTeamMembersByInvestigation
} from '../controllers/investigationTeamMember.controller';
import {
    createInvestigationTeamMemberValidator,
    investigationTeamMemberInvestigationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Team Member
// Code: ESAVI-INVTEAM-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14, F28, F29 and F30 already fixed: the detail is captured in the same operational flow as
// the case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationTeamMemberValidator, validateFields, createInvestigationTeamMember);

// Get All Investigation Team Members By Investigation - For Admin
// Code: ESAVI-INVTEAM-002B
// Declared BEFORE /investigation/:id, or Express would capture 'admin' as the :id of that route.
// It is the only door to a member that was retired, and the operation the new index
// IX_investigationTeamMember_investigation exists for: the partial unique index of sortOrder
// excludes precisely the rows with deletedAt sealed that this listing has to read
router.get('/admin/investigation/:id', tokenValidation, validateUserRole(ADMIN), ...investigationTeamMemberInvestigationIdValidator, validateFields, getAllInvestigationTeamMembersByInvestigation);

// Get Investigation Team Members By Investigation
// Code: ESAVI-INVTEAM-002A
// The listing by parent, and not a global listing with filters: this is a collection, and its
// members only make sense read together and in their order. It is entered by the investigationId,
// so /:id is the access by member and never the access by investigation
router.get('/investigation/:id', tokenValidation, validateUserRole(USER), ...investigationTeamMemberInvestigationIdValidator, validateFields, getInvestigationTeamMembersByInvestigation);

export default router;
