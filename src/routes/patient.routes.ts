import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createPatient,
    getAllPatients,
    getPatientById,
    getPatients,
    searchPatientsByIdentifier,
    updatePatient
} from '../controllers/patient.controller';
import {
    createPatientValidator,
    patientIdentifierValidator,
    patientIdValidator,
    patientListValidator,
    updatePatientValidator
} from '../validators';

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

// Search Patients by Identifier - documentNumber, passportNumber or healthSystemCode
// Code: ESAVI-PATIENT-006
router.get('/search/:identifier', tokenValidation, validateUserRole(USER), ...patientIdentifierValidator, ...patientListValidator, validateFields, searchPatientsByIdentifier);

// Get Patient by ID
// Code: ESAVI-PATIENT-003
// Declared after the literal paths so Express does not capture 'admin' or 'search' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...patientIdValidator, validateFields, getPatientById);

// Update Patient
// Code: ESAVI-PATIENT-004
// USER for the same reason as 001: correcting the patient is part of reporting the ESAVI
router.put('/:id', tokenValidation, validateUserRole(USER), ...patientIdValidator, ...updatePatientValidator, validateFields, updatePatient);

export default router;
