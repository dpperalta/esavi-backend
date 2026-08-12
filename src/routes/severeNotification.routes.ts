import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createSevereNotification,
    getSevereNotificationByCaseId,
    getSevereNotificationById
} from '../controllers/severeNotification.controller';
import {
    createSevereNotificationValidator,
    severeNotificationCaseIdValidator,
    severeNotificationIdValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Severe Notification
// Code: ESAVI-SEVNOT-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09 and
// F10 already fixed: the clinical detail is captured in the same operational flow as the
// notification, and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createSevereNotificationValidator, validateFields, createSevereNotification);

// Get Severe Notification by Case
// Code: ESAVI-SEVNOT-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...severeNotificationCaseIdValidator, validateFields, getSevereNotificationByCaseId);

// Get Severe Notification by ID
// Code: ESAVI-SEVNOT-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the notificationId: this entity has no identifier of its own
router.get('/:id', tokenValidation, validateUserRole(USER), ...severeNotificationIdValidator, validateFields, getSevereNotificationById);

export default router;
