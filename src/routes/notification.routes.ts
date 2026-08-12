import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotification,
    getAllNotifications,
    getNotificationByCaseId,
    getNotificationById,
    getNotifications
} from '../controllers/notification.controller';
import {
    createNotificationValidator,
    notificationCaseIdValidator,
    notificationIdValidator,
    notificationListValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

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

// Get Notification by Case
// Code: ESAVI-NOTIFCN-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...notificationCaseIdValidator, validateFields, getNotificationByCaseId);

// Get Notification by ID
// Code: ESAVI-NOTIFCN-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationIdValidator, validateFields, getNotificationById);

export default router;
