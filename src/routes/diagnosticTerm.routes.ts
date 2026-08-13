import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createDiagnosticTerm, getDiagnosticTerms } from '../controllers/diagnosticTerm.controller';
import { createDiagnosticTermValidator, diagnosticTermListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Diagnostic Term
// Code: ESAVI-DIAGTERM-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createDiagnosticTermValidator, validateFields, createDiagnosticTerm);

// Get Active Diagnostic Terms
// Code: ESAVI-DIAGTERM-002A
router.get('/', tokenValidation, validateUserRole(USER), ...diagnosticTermListValidator, validateFields, getDiagnosticTerms);

export default router;
