import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createInvestigationTeamMember } from '../controllers/investigationTeamMember.controller';
import { createInvestigationTeamMemberValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Investigation Team Member
// Code: ESAVI-INVTEAM-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14, F28, F29 and F30 already fixed: the detail is captured in the same operational flow as
// the case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationTeamMemberValidator, validateFields, createInvestigationTeamMember);

export default router;
