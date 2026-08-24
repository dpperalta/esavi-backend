import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationPregnancyCondition,
    deleteInvestigationPregnancyCondition,
    getAllInvestigationPregnancyConditionsByInvestigation,
    getInvestigationPregnancyConditionById,
    getInvestigationPregnancyConditionsByInvestigation,
    updateInvestigationPregnancyCondition
} from '../controllers/investigationPregnancyCondition.controller';
import {
    createInvestigationPregnancyConditionValidator,
    investigationPregnancyConditionIdValidator,
    investigationPregnancyConditionInvestigationIdValidator,
    investigationPregnancyConditionListValidator,
    updateInvestigationPregnancyConditionValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

// Get All Investigation Pregnancy Conditions By Investigation - For Admin
// Code: ESAVI-INVPREG-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own letter
// in the five places: they also differ in the minimum role
router.get('/admin/investigation/:id', tokenValidation, validateUserRole(ADMIN), ...investigationPregnancyConditionInvestigationIdValidator, ...investigationPregnancyConditionListValidator, validateFields, getAllInvestigationPregnancyConditionsByInvestigation);

// Get Active Investigation Pregnancy Conditions By Investigation
// Code: ESAVI-INVPREG-002A
// The :id is the investigationId — which names the medical history, not the investigation — and not a
// condition id: the listing is entered by the foreign key. Declared after /admin/investigation/:id,
// which is the more specific literal path
router.get('/investigation/:id', tokenValidation, validateUserRole(USER), ...investigationPregnancyConditionInvestigationIdValidator, ...investigationPregnancyConditionListValidator, validateFields, getInvestigationPregnancyConditionsByInvestigation);

// Get Investigation Pregnancy Condition by ID
// Code: ESAVI-INVPREG-003
// Declared after every literal path: an /:id first would swallow /admin, /investigation, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationPregnancyConditionIdValidator, validateFields, getInvestigationPregnancyConditionById);

// Update Investigation Pregnancy Condition
// Code: ESAVI-INVPREG-004
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationPregnancyConditionIdValidator, ...updateInvestigationPregnancyConditionValidator, validateFields, updateInvestigationPregnancyCondition);

// Delete Investigation Pregnancy Condition - Soft delete
// Code: ESAVI-INVPREG-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...investigationPregnancyConditionIdValidator, validateFields, deleteInvestigationPregnancyCondition);

export default router;
