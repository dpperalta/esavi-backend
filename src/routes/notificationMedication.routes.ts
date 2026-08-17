import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationMedication
} from '../controllers/notificationMedication.controller';
import {
    createNotificationMedicationValidator
} from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Medication
// Code: ESAVI-NOTIFMED-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationMedicationValidator, validateFields, createNotificationMedication);

export default router;
