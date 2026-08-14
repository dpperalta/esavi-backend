import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationEvent,
    getNotificationEventsByNotification
} from '../controllers/notificationEvent.controller';
import {
    createNotificationEventValidator,
    notificationEventListValidator,
    notificationEventNotificationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Event
// Code: ESAVI-NOTIFEVT-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationEventValidator, validateFields, createNotificationEvent);

// Get Active Notification Events By Notification
// Code: ESAVI-NOTIFEVT-002A
// The :id is the notificationId, not an event id: the listing is entered by the foreign key.
// Declared after /admin/notification/:id, which is the more specific literal path
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationEventNotificationIdValidator, ...notificationEventListValidator, validateFields, getNotificationEventsByNotification);

export default router;
