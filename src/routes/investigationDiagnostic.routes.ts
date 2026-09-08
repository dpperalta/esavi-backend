import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createInvestigationDiagnostic,
    deleteInvestigationDiagnostic,
    getAllInvestigationDiagnosticsByInvestigation,
    getInvestigationDiagnosticById,
    getInvestigationDiagnosticsByCaseId,
    getInvestigationDiagnosticsByInvestigation,
    updateInvestigationDiagnostic
} from '../controllers/investigationDiagnostic.controller';
import {
    createInvestigationDiagnosticValidator,
    investigationDiagnosticCaseIdValidator,
    investigationDiagnosticIdValidator,
    investigationDiagnosticInvestigationIdValidator,
    updateInvestigationDiagnosticValidator
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

// Get Investigation Diagnostics By Case ID
// Code: ESAVI-INVDIAG-006
// Declared BEFORE /:id, or Express would capture 'case' as the :id of that route. The real query of
// the domain: the client holds the caseId and not the investigationId. No admin variant is
// declared — whoever needs the retired ones enters through the 002B with the investigationId every
// row of this response carries
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...investigationDiagnosticCaseIdValidator, validateFields, getInvestigationDiagnosticsByCaseId);

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

// Update Investigation Diagnostic
// Code: ESAVI-INVDIAG-004
// USER, like the 001: whoever captures the investigation is who corrects its diagnoses. The update
// is differential — the write is fired by the real change of value and never by the presence of the
// key — so resending the whole response of the GET writes nothing at all
router.put('/:id', tokenValidation, validateUserRole(USER), ...investigationDiagnosticIdValidator, ...updateInvestigationDiagnosticValidator, validateFields, updateInvestigationDiagnostic);

// Delete Investigation Diagnostic
// Code: ESAVI-INVDIAG-005A
// ADMIN, the canonical role for the soft delete. It seals deletedAt, which frees the sortOrder from
// the partial unique index — deliberate: the gap stays available for the next diagnosis, and it is
// the collision ESAVI-INVDIAG-005B has to resolve
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...investigationDiagnosticIdValidator, validateFields, deleteInvestigationDiagnostic);

export default router;
