import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateNotificationMedicalHistory,
    createNotificationMedicalHistory,
    getAllNotificationMedicalHistoriesByNotification,
    getNotificationMedicalHistoriesByCaseId,
    deleteNotificationMedicalHistory,
    getNotificationMedicalHistoryById,
    updateNotificationMedicalHistory,
    getNotificationMedicalHistoriesByNotification
} from '../controllers/notificationMedicalHistory.controller';
import {
    createNotificationMedicalHistoryValidator,
    notificationMedicalHistoryCaseIdValidator,
    notificationMedicalHistoryIdValidator,
    notificationMedicalHistoryListValidator,
    notificationMedicalHistoryNotificationIdValidator,
    updateNotificationMedicalHistoryValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Medical History
// Code: ESAVI-MEDHIST-001
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationMedicalHistoryValidator, validateFields, createNotificationMedicalHistory);

// Get Notification Medical Histories by Case
// Code: ESAVI-MEDHIST-006
// The real query of the domain, and the only non-canonical operation of the entity. Like the 006 of
// NOTIFEVT, NOTIFMED and NOTIFVAC it does have an HTTP route: it is a read, and it opens no door the
// 002A does not have open already
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...notificationMedicalHistoryCaseIdValidator, ...notificationMedicalHistoryListValidator, validateFields, getNotificationMedicalHistoriesByCaseId);
// Get All Notification Medical Histories By Notification - For Admin
// Code: ESAVI-MEDHIST-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places. It goes before /notification/:id, or that one would swallow the
// literal /admin segment
router.get('/admin/notification/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicalHistoryNotificationIdValidator, ...notificationMedicalHistoryListValidator, validateFields, getAllNotificationMedicalHistoriesByNotification);

// Get Active Notification Medical Histories By Notification
// Code: ESAVI-MEDHIST-002A
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationMedicalHistoryNotificationIdValidator, ...notificationMedicalHistoryListValidator, validateFields, getNotificationMedicalHistoriesByNotification);

// Activate Notification Medical History - For SuperAdmin
// Code: ESAVI-MEDHIST-005B
// It stays in SUPERADMIN with F21 and F22 and not with F33: the reactivation drags the sortOrder
// reassignment, and in the notification block that operation never dropped below SUPERADMIN
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationMedicalHistoryIdValidator, validateFields, activateNotificationMedicalHistory);
// Get Notification Medical History By ID
// Code: ESAVI-MEDHIST-003
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationMedicalHistoryIdValidator, validateFields, getNotificationMedicalHistoryById);
// Update Notification Medical History
// Code: ESAVI-MEDHIST-004
// USER and not ADMIN, which is the declared deviation from the matrix of the notification family:
// whoever records the antecedent is whoever corrects it, and forcing an ADMIN in to fix a capture
// typo would break the operational flow in half
router.put('/:id', tokenValidation, validateUserRole(USER), ...notificationMedicalHistoryIdValidator, ...updateNotificationMedicalHistoryValidator, validateFields, updateNotificationMedicalHistory);
// Delete Notification Medical History - For Admin
// Code: ESAVI-MEDHIST-005A
// Blocked by nothing: the table is a leaf of the graph. It seals deletedAt, which frees the
// sortOrder from the partial unique index, and it does not touch the notification's flag
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicalHistoryIdValidator, validateFields, deleteNotificationMedicalHistory);

export default router;
