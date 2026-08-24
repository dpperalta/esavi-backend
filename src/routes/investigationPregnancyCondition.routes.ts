import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationPregnancyCondition
} from '../controllers/investigationPregnancyCondition.controller';
import {
    createInvestigationPregnancyConditionValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/investigation, /investigation, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Investigation Pregnancy Condition
// Code: ESAVI-INVPREG-001
// USER and not ADMIN, following the parent F32 and the twelve specs before it: the condition is
// captured in the same operational flow as the case, and splitting the pregnancy form between two
// roles would break the capture in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationPregnancyConditionValidator, validateFields, createInvestigationPregnancyCondition);

export default router;
