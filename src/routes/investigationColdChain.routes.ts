import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationColdChain,
    getAllInvestigationColdChains,
    getInvestigationColdChainByCaseId,
    getInvestigationColdChainById,
    getInvestigationColdChains
} from '../controllers/investigationColdChain.controller';
import {
    createInvestigationColdChainValidator,
    investigationColdChainCaseIdValidator,
    investigationColdChainIdValidator,
    investigationColdChainListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Cold Chain
// Code: ESAVI-INVCOLD-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10,
// F13, F14 and F28 to F37 already fixed: the detail is captured in the same operational flow as the
// case, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationColdChainValidator, validateFields, createInvestigationColdChain);

// Get Investigation Cold Chains
// Code: ESAVI-INVCOLD-002A
// Only the cold chains of active investigations. The entity has no isActive of its own: the filter
// lands on the where of the investigation include, which is the real source of its visibility
router.get('/', tokenValidation, validateUserRole(USER), ...investigationColdChainListValidator, validateFields, getInvestigationColdChains);

// Get All Investigation Cold Chains - For Admin
// Code: ESAVI-INVCOLD-002B
// Declared with the literal paths, before /:id. An ADMIN needs some way of reaching the cold chain
// of a retired investigation
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...investigationColdChainListValidator, validateFields, getAllInvestigationColdChains);

// Get Investigation Cold Chain by Case
// Code: ESAVI-INVCOLD-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared before
// /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationColdChainCaseIdValidator, validateFields, getInvestigationColdChainByCaseId);

// Get Investigation Cold Chain by ID
// Code: ESAVI-INVCOLD-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the investigationId: this entity has no identifier of its own, so this is already the
// access by investigation
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationColdChainIdValidator, validateFields, getInvestigationColdChainById);

export default router;
