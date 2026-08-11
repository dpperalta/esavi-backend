import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createClassification } from '../controllers/classification.controller';
import { createClassificationValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Classification
// Code: ESAVI-CLASSIF-001
// USER and not ADMIN, departing from the canonical matrix: classifying is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createClassificationValidator, validateFields, createClassification);

export default router;
