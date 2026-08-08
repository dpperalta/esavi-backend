import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createPatient } from '../controllers/patient.controller';
import { createPatientValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Patient
// Code: ESAVI-PATIENT-001
// USER and not ADMIN, departing from the canonical matrix: whoever reports an ESAVI is
// operational staff and needs to register the patient who does not exist yet
router.post('/', tokenValidation, validateUserRole(USER), ...createPatientValidator, validateFields, createPatient);

export default router;
