import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationDiagnostic,
    getAllInvestigationDiagnosticsByInvestigation,
    getInvestigationDiagnosticById,
    getInvestigationDiagnosticsByInvestigation
} from '../controllers/investigationDiagnostic.controller';
import {
    createInvestigationDiagnosticValidator,
    investigationDiagnosticIdValidator,
    investigationDiagnosticInvestigationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Investigation Diagnostic
// Code: ESAVI-INVDIAG-001
// USER and not ADMIN, the matrix of the investigation family: whoever captures the investigation is
// the same USER who records its final diagnoses. It is the literal matrix of INVTEAM, INVPREG and
// INVVACAD, and the deviation from the canonical one of §9 belongs to the whole family and not to
// this entity
router.post('/', tokenValidation, validateUserRole(USER), ...createInvestigationDiagnosticValidator, validateFields, createInvestigationDiagnostic);

// Get All Investigation Diagnostics By Investigation - For Admin
// Code: ESAVI-INVDIAG-002B
// Declared BEFORE /investigation/:id, or Express would capture 'admin' as the :id of that route.
// It is the only door to a diagnosis that was retired, and the operation the index
// IX_investigationDiagnostic_investigation exists for: the partial unique index of sortOrder
// excludes precisely the rows with deletedAt sealed that this listing has to read
router.get('/admin/investigation/:id', tokenValidation, validateUserRole(ADMIN), ...investigationDiagnosticInvestigationIdValidator, validateFields, getAllInvestigationDiagnosticsByInvestigation);

// Get Investigation Diagnostics By Investigation
// Code: ESAVI-INVDIAG-002A
// The listing by parent, and not a global listing with filters: this is a collection, and its
// diagnoses only make sense read together and in their order. It is entered by the investigationId,
// never by /, and it admits no filter — not even by diagnosticTypeItemId
router.get('/investigation/:id', tokenValidation, validateUserRole(USER), ...investigationDiagnosticInvestigationIdValidator, validateFields, getInvestigationDiagnosticsByInvestigation);

// Get Investigation Diagnostic By ID
// Code: ESAVI-INVDIAG-003
// Declared AFTER every literal route, or Express would capture 'case', 'admin', 'investigation',
// 'purge' and 'activate' as an :id and the UUID validator would answer 400. :id is the
// diagnosticId, never the investigationId: the access by parent is the 002A
router.get('/:id', tokenValidation, validateUserRole(USER), ...investigationDiagnosticIdValidator, validateFields, getInvestigationDiagnosticById);

export default router;
