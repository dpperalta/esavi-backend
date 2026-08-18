import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationVaccine,
    getNotificationVaccinesByNotification
} from '../controllers/notificationVaccine.controller';
import {
    createNotificationVaccineValidator,
    notificationVaccineListValidator,
    notificationVaccineNotificationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Vaccine
// Code: ESAVI-NOTIFVAC-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationVaccineValidator, validateFields, createNotificationVaccine);

// Get Active Notification Vaccines By Notification
// Code: ESAVI-NOTIFVAC-002A
// The :id is the notificationId, not a vaccine id: the listing is entered by the foreign key. It
// will be declared after /admin/notification/:id, which is the more specific literal path
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationVaccineNotificationIdValidator, ...notificationVaccineListValidator, validateFields, getNotificationVaccinesByNotification);

export default router;
