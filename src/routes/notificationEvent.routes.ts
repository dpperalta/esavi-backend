import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationEvent,
    getAllNotificationEventsByNotification,
    getNotificationEventById,
    getNotificationEventsByNotification
} from '../controllers/notificationEvent.controller';
import {
    createNotificationEventValidator,
    notificationEventIdValidator,
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

// Get All Notification Events By Notification - For Admin
// Code: ESAVI-NOTIFEVT-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places: they also differ in the minimum role
router.get('/admin/notification/:id', tokenValidation, validateUserRole(ADMIN), ...notificationEventNotificationIdValidator, ...notificationEventListValidator, validateFields, getAllNotificationEventsByNotification);

// Get Active Notification Events By Notification
// Code: ESAVI-NOTIFEVT-002A
// The :id is the notificationId, not an event id: the listing is entered by the foreign key.
// Declared after /admin/notification/:id, which is the more specific literal path
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationEventNotificationIdValidator, ...notificationEventListValidator, validateFields, getNotificationEventsByNotification);

// Get Notification Event by ID
// Code: ESAVI-NOTIFEVT-003
// Declared after every literal path so Express does not capture 'case', 'admin', 'notification',
// 'purge' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationEventIdValidator, validateFields, getNotificationEventById);

export default router;
