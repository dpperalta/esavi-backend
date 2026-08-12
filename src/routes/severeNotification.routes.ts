import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createSevereNotification } from '../controllers/severeNotification.controller';
import { createSevereNotificationValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Severe Notification
// Code: ESAVI-SEVNOT-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09 and
// F10 already fixed: the clinical detail is captured in the same operational flow as the
// notification, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createSevereNotificationValidator, validateFields, createSevereNotification);

export default router;
