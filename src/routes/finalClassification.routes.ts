import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createFinalClassification,
    getAllFinalClassifications,
    getFinalClassifications
} from '../controllers/finalClassification.controller';
import {
    createFinalClassificationValidator,
    finalClassificationListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

export default router;
