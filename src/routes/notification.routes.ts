import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateNotification,
    createNotification,
    deleteNotification,
    getAllNotifications,
    getNotificationByCaseId,
    getNotificationById,
    getNotifications,
    purgeNotification,
    updateNotification
} from '../controllers/notification.controller';
import {
    createNotificationValidator,
    notificationCaseIdValidator,
    notificationIdValidator,
    notificationListValidator,
    updateNotificationValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Notification
// Code: ESAVI-NOTIFCN-001
// USER and not ADMIN, departing from the canonical matrix: notifying is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationValidator, validateFields, createNotification);

// Get Notifications
// Code: ESAVI-NOTIFCN-002A
router.get('/', tokenValidation, validateUserRole(USER), ...notificationListValidator, validateFields, getNotifications);

// Get All Notifications - For Admin
// Code: ESAVI-NOTIFCN-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...notificationListValidator, validateFields, getAllNotifications);

// Activate Notification - For SuperAdmin
// Code: ESAVI-NOTIFCN-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationIdValidator, validateFields, activateNotification);

// Purge Notification - Physical delete, for SuperAdmin
// Code: ESAVI-NOTIFCN-005C
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationIdValidator, validateFields, purgeNotification);

// Get Notification by Case
// Code: ESAVI-NOTIFCN-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...notificationCaseIdValidator, validateFields, getNotificationByCaseId);

// Get Notification by ID
// Code: ESAVI-NOTIFCN-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationIdValidator, validateFields, getNotificationById);

// Update Notification
// Code: ESAVI-NOTIFCN-004
// USER for the same reason as 001: correcting the notification is part of the same clinical flow
router.put('/:id', tokenValidation, validateUserRole(USER), ...notificationIdValidator, ...updateNotificationValidator, validateFields, updateNotification);

// Soft delete Notification
// Code: ESAVI-NOTIFCN-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationIdValidator, validateFields, deleteNotification);

export default router;
