import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNonSevereNotification,
    getNonSevereNotificationByCaseId,
    getNonSevereNotificationById,
    purgeNonSevereNotification,
    updateNonSevereNotification
} from '../controllers/nonSevereNotification.controller';
import {
    createNonSevereNotificationValidator,
    nonSevereNotificationCaseIdValidator,
    nonSevereNotificationIdValidator,
    updateNonSevereNotificationValidator
} from '../validators';

const { SUPERADMIN, USER } = ROLES;

const router = Router();

// Create Non Severe Notification
// Code: ESAVI-NSEVNOT-001
// USER and not ADMIN, the same deviation from the canonical matrix that F05, F06, F07, F09, F10
// and F13 already fixed: the detail is captured in the same operational flow as the notification,
// and splitting it across two roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNonSevereNotificationValidator, validateFields, createNonSevereNotification);

// Purge Non Severe Notification - Physical delete, for SuperAdmin
// Code: ESAVI-NSEVNOT-005C
// Declared with the literal paths, before /:id. The entity has no 005A or 005B: it does not
// have an activity flag and does not manage its own state — its header does
router.delete('/purge/:id', tokenValidation, validateUserRole(SUPERADMIN), ...nonSevereNotificationIdValidator, validateFields, purgeNonSevereNotification);

// Get Non Severe Notification by Case
// Code: ESAVI-NSEVNOT-006
// The real query of the domain, and the only non-canonical operation of the entity. Declared
// before /:id so Express does not capture 'case' as an :id
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...nonSevereNotificationCaseIdValidator, validateFields, getNonSevereNotificationByCaseId);

// Get Non Severe Notification by ID
// Code: ESAVI-NSEVNOT-003
// Declared after the literal paths so Express does not capture them as an :id.
// The :id is the notificationId: this entity has no identifier of its own
router.get('/:id', tokenValidation, validateUserRole(USER), ...nonSevereNotificationIdValidator, validateFields, getNonSevereNotificationById);

// Update Non Severe Notification
// Code: ESAVI-NSEVNOT-004
// USER for the same reason as 001: correcting the detail is part of the same operational flow
router.put('/:id', tokenValidation, validateUserRole(USER), ...nonSevereNotificationIdValidator, ...updateNonSevereNotificationValidator, validateFields, updateNonSevereNotification);

export default router;
