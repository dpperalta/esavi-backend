import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createNotification } from '../controllers/notification.controller';
import { createNotificationValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Notification
// Code: ESAVI-NOTIFCN-001
// USER and not ADMIN, departing from the canonical matrix: notifying is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationValidator, validateFields, createNotification);

export default router;
