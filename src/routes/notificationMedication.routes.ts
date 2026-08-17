import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationMedication,
    getNotificationMedicationsByNotification
} from '../controllers/notificationMedication.controller';
import {
    createNotificationMedicationValidator,
    notificationMedicationListValidator,
    notificationMedicationNotificationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Medication
// Code: ESAVI-NOTIFMED-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationMedicationValidator, validateFields, createNotificationMedication);

// Get Active Notification Medications By Notification
// Code: ESAVI-NOTIFMED-002A
// The :id is the notificationId, not a medication id: the listing is entered by the foreign key.
// Declared after /admin/notification/:id, which is the more specific literal path
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationMedicationNotificationIdValidator, ...notificationMedicationListValidator, validateFields, getNotificationMedicationsByNotification);

export default router;
