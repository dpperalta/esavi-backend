import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationDiagnostic
} from '../controllers/investigationDiagnostic.controller';
import {
    createInvestigationDiagnosticValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Investigation Diagnostic
// Code: ESAVI-INVDIAG-001
// USER and not ADMIN, the matrix of the investigation family: whoever captures the investigation is
// the same USER who records its final diagnoses. It is the literal matrix of INVTEAM, INVPREG and
// INVVACAD, and the deviation from the canonical one of §9 belongs to the whole family and not to
// this entity
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationDiagnosticValidator, validateFields, createInvestigationDiagnostic);

export default router;
