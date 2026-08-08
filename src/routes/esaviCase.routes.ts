import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createEsaviCase, getAllEsaviCases, getEsaviCases } from '../controllers/esaviCase.controller';
import { createEsaviCaseValidator, esaviCaseListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create ESAVI Case
// Code: ESAVI-CASE-001
// USER and not ADMIN, departing from the canonical matrix: whoever opens an ESAVI case is the
// operational staff who has just registered the patient, and with create in ADMIN the flow
// would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createEsaviCaseValidator, validateFields, createEsaviCase);

// Get ESAVI Cases
// Code: ESAVI-CASE-002A
router.get('/', tokenValidation, validateUserRole(USER), ...esaviCaseListValidator, validateFields, getEsaviCases);

// Get All ESAVI Cases - For Admin
// Code: ESAVI-CASE-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...esaviCaseListValidator, validateFields, getAllEsaviCases);

export default router;
