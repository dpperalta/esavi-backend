import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createClassification,
    getAllClassifications,
    getClassifications
} from '../controllers/classification.controller';
import { classificationListValidator, createClassificationValidator } from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Classification
// Code: ESAVI-CLASSIF-001
// USER and not ADMIN, departing from the canonical matrix: classifying is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createClassificationValidator, validateFields, createClassification);

// Get Classifications
// Code: ESAVI-CLASSIF-002A
router.get('/', tokenValidation, validateUserRole(USER), ...classificationListValidator, validateFields, getClassifications);

// Get All Classifications - For Admin
// Code: ESAVI-CLASSIF-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...classificationListValidator, validateFields, getAllClassifications);

export default router;
