import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createDiagnosticTerm, getAllDiagnosticTerms, getDiagnosticTermById, getDiagnosticTerms } from '../controllers/diagnosticTerm.controller';
import { createDiagnosticTermValidator, diagnosticTermIdValidator, diagnosticTermListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Diagnostic Term
// Code: ESAVI-DIAGTERM-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createDiagnosticTermValidator, validateFields, createDiagnosticTerm);

// Get Active Diagnostic Terms
// Code: ESAVI-DIAGTERM-002A
router.get('/', tokenValidation, validateUserRole(USER), ...diagnosticTermListValidator, validateFields, getDiagnosticTerms);

// Get All Diagnostic Terms - For Admin
// Code: ESAVI-DIAGTERM-002B
// Literal path, declared before '/:id' so Express does not capture 'admin' as an :id
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...diagnosticTermListValidator, validateFields, getAllDiagnosticTerms);

// Get Diagnostic Term by ID
// Code: ESAVI-DIAGTERM-003
// Declared after the literal paths so Express does not capture 'admin' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...diagnosticTermIdValidator, validateFields, getDiagnosticTermById);

export default router;
