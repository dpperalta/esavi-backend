import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationMedicalHistory,
    getAllNotificationMedicalHistoriesByNotification,
    getNotificationMedicalHistoriesByNotification
} from '../controllers/notificationMedicalHistory.controller';
import {
    createNotificationMedicalHistoryValidator,
    notificationMedicalHistoryListValidator,
    notificationMedicalHistoryNotificationIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Medical History
// Code: ESAVI-MEDHIST-001
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationMedicalHistoryValidator, validateFields, createNotificationMedicalHistory);

// Get All Notification Medical Histories By Notification - For Admin
// Code: ESAVI-MEDHIST-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places. It goes before /notification/:id, or that one would swallow the
// literal /admin segment
router.get('/admin/notification/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicalHistoryNotificationIdValidator, ...notificationMedicalHistoryListValidator, validateFields, getAllNotificationMedicalHistoriesByNotification);

// Get Active Notification Medical Histories By Notification
// Code: ESAVI-MEDHIST-002A
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationMedicalHistoryNotificationIdValidator, ...notificationMedicalHistoryListValidator, validateFields, getNotificationMedicalHistoriesByNotification);

export default router;
