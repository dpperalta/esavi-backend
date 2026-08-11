import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createClassification,
    getAllClassifications,
    getClassificationByCaseId,
    getClassificationById,
    getClassifications
} from '../controllers/classification.controller';
import {
    classificationCaseIdValidator,
    classificationIdValidator,
    classificationListValidator,
    createClassificationValidator
} from '../validators';

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

// Get Classification by Case
// Code: ESAVI-CLASSIF-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...classificationCaseIdValidator, validateFields, getClassificationByCaseId);

// Get Classification by ID
// Code: ESAVI-CLASSIF-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...classificationIdValidator, validateFields, getClassificationById);

export default router;
