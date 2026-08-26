import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createFinalClassification } from '../controllers/finalClassification.controller';
import { createFinalClassificationValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Final Classification
// Code: ESAVI-FINCLASS-001
// USER and not ADMIN, departing from the canonical matrix: the causality verdict is captured in
// the same operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createFinalClassificationValidator, validateFields, createFinalClassification);

export default router;
