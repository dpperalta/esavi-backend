import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationEvent,
    getAllNotificationEventsByNotification,
    getNotificationEventById,
    getNotificationEventsByCaseId,
    getNotificationEventsByNotification,
    updateNotificationEvent,
    deleteNotificationEvent,
    activateNotificationEvent,
    purgeNotificationEvent
} from '../controllers/notificationEvent.controller';
import {
    createNotificationEventValidator,
    notificationEventCaseIdValidator,
    notificationEventIdValidator,
    notificationEventListValidator,
    notificationEventNotificationIdValidator,
    updateNotificationEventValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Event
// Code: ESAVI-NOTIFEVT-001
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationEventValidator, validateFields, createNotificationEvent);

// Get Notification Events by Case
// Code: ESAVI-NOTIFEVT-006
// The real query of the domain, and the only non-canonical operation of the entity. Unlike the
// 006 of DIAGTERM it does have an HTTP route: it is a read, and it opens no door the 002A does
// not have open already
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...notificationEventCaseIdValidator, ...notificationEventListValidator, validateFields, getNotificationEventsByCaseId);

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

// Purge Notification Event - Physical delete, for SuperAdmin
// Code: ESAVI-NOTIFEVT-005C
// Declared with the literal paths, before /:id
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationEventIdValidator, validateFields, purgeNotificationEvent);

// Activate Notification Event - For SuperAdmin
// Code: ESAVI-NOTIFEVT-005B
// Declared with the literal paths, before /:id
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationEventIdValidator, validateFields, activateNotificationEvent);

// Get Notification Event by ID
// Code: ESAVI-NOTIFEVT-003
// Declared after every literal path so Express does not capture 'case', 'admin', 'notification',
// 'purge' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationEventIdValidator, validateFields, getNotificationEventById);

// Update Notification Event
// Code: ESAVI-NOTIFEVT-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationEventIdValidator, ...updateNotificationEventValidator, validateFields, updateNotificationEvent);

// Delete Notification Event - Logical delete
// Code: ESAVI-NOTIFEVT-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationEventIdValidator, validateFields, deleteNotificationEvent);

export default router;
