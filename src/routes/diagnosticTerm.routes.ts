import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createDiagnosticTerm } from '../controllers/diagnosticTerm.controller';
import { createDiagnosticTermValidator } from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// Create Diagnostic Term
// Code: ESAVI-DIAGTERM-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createDiagnosticTermValidator, validateFields, createDiagnosticTerm);

export default router;
