import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateFinalClassification,
    createFinalClassification,
    deleteFinalClassification,
    getAllFinalClassifications,
    getFinalClassificationByCaseId,
    getFinalClassificationById,
    getFinalClassifications,
    purgeFinalClassification,
    updateFinalClassification
} from '../controllers/finalClassification.controller';
import {
    createFinalClassificationValidator,
    finalClassificationCaseIdValidator,
    finalClassificationIdValidator,
    finalClassificationListValidator,
    updateFinalClassificationValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Final Classification
// Code: ESAVI-FINCLASS-001
// USER and not ADMIN, departing from the canonical matrix: the causality verdict is captured in
// the same operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createFinalClassificationValidator, validateFields, createFinalClassification);

// Get Final Classifications
// Code: ESAVI-FINCLASS-002A
router.get('/', tokenValidation, validateUserRole(USER), ...finalClassificationListValidator, validateFields, getFinalClassifications);

// Get All Final Classifications - For Admin
// Code: ESAVI-FINCLASS-002B
// Declared before /:id so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...finalClassificationListValidator, validateFields, getAllFinalClassifications);

// Activate Final Classification - For SuperAdmin
// Code: ESAVI-FINCLASS-005B
// Declared before /:id so Express does not capture 'activate' as an :id
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...finalClassificationIdValidator, validateFields, activateFinalClassification);

// Purge Final Classification - Physical delete, for SuperAdmin
// Code: ESAVI-FINCLASS-005C
// Declared before /:id so Express does not capture 'purge' as an :id
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...finalClassificationIdValidator, validateFields, purgeFinalClassification);

// Get Final Classification by Case
// Code: ESAVI-FINCLASS-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...finalClassificationCaseIdValidator, validateFields, getFinalClassificationByCaseId);

// Get Final Classification by ID
// Code: ESAVI-FINCLASS-003
// Declared after the literal paths so Express does not capture 'admin' as an :id. The :id is the
// finalClassificationId, which is why the 006 by case is not redundant with this one
router.get('/:id', tokenValidation, validateUserRole(USER), ...finalClassificationIdValidator, validateFields, getFinalClassificationById);

// Update Final Classification
// Code: ESAVI-FINCLASS-004
// USER for the same reason as 001: correcting the verdict is part of the same clinical flow
router.put('/:id', tokenValidation, validateUserRole(USER), ...finalClassificationIdValidator, ...updateFinalClassificationValidator, validateFields, updateFinalClassification);

// Soft delete Final Classification
// Code: ESAVI-FINCLASS-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...finalClassificationIdValidator, validateFields, deleteFinalClassification);

export default router;
