import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNonSevereNotification,
    getNonSevereNotificationById
} from '../controllers/nonSevereNotification.controller';
import {
    createNonSevereNotificationValidator,
    nonSevereNotificationIdValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Non Severe Notification
// Code: ESAVI-NSEVNOT-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10
// and F13 already fixed: the detail is captured in the same operational flow as the notification,
// and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNonSevereNotificationValidator, validateFields, createNonSevereNotification);

// Get Non Severe Notification by ID
// Code: ESAVI-NSEVNOT-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the notificationId: this entity has no identifier of its own
router.get('/:id', tokenValidation, validateUserRole(USER), ...nonSevereNotificationIdValidator, validateFields, getNonSevereNotificationById);

export default router;
