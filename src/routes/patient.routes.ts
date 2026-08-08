import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createPatient,
    getAllPatients,
    getPatients
} from '../controllers/patient.controller';
import { createPatientValidator, patientListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// Create Patient
// Code: ESAVI-PATIENT-001
// USER and not ADMIN, departing from the canonical matrix: whoever reports an ESAVI is
// operational staff and needs to register the patient who does not exist yet
router.post('/', tokenValidation, validateUserRole(USER), ...createPatientValidator, validateFields, createPatient);

// Get Patients
// Code: ESAVI-PATIENT-002A
router.get('/', tokenValidation, validateUserRole(USER), ...patientListValidator, validateFields, getPatients);

// Get All Patients - For Admin
// Code: ESAVI-PATIENT-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...patientListValidator, validateFields, getAllPatients);

export default router;
