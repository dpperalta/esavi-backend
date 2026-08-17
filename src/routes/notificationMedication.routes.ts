import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationMedication,
    deleteNotificationMedication,
    getAllNotificationMedicationsByNotification,
    getNotificationMedicationById,
    getNotificationMedicationsByCaseId,
    getNotificationMedicationsByNotification,
    updateNotificationMedication
} from '../controllers/notificationMedication.controller';
import {
    createNotificationMedicationValidator,
    notificationMedicationCaseIdValidator,
    notificationMedicationIdValidator,
    notificationMedicationListValidator,
    notificationMedicationNotificationIdValidator,
    updateNotificationMedicationValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The nine routes of this entity are declared in a fixed order: the five literal paths — /case,
// /admin/notification, /notification, /purge and /activate — go before /:id, or Express would
// capture them as an :id and the UUID validator would answer 400

// Create Notification Medication
// Code: ESAVI-NOTIFMED-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationMedicationValidator, validateFields, createNotificationMedication);

// Get Notification Medications by Case
// Code: ESAVI-NOTIFMED-006
// The real query of the domain, and the only non-canonical operation of the entity. Like the 006 of
// NOTIFEVT it does have an HTTP route: it is a read, and it opens no door the 002A does not have
// open already
router.get('/case/:caseId', tokenValidation, validateUserRole(USER), ...notificationMedicationCaseIdValidator, ...notificationMedicationListValidator, validateFields, getNotificationMedicationsByCaseId);

// Get All Notification Medications By Notification - For Admin
// Code: ESAVI-NOTIFMED-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places: they also differ in the minimum role
router.get('/admin/notification/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicationNotificationIdValidator, ...notificationMedicationListValidator, validateFields, getAllNotificationMedicationsByNotification);

// Get Active Notification Medications By Notification
// Code: ESAVI-NOTIFMED-002A
// The :id is the notificationId, not a medication id: the listing is entered by the foreign key.
// Declared after /admin/notification/:id, which is the more specific literal path
router.get('/notification/:id', tokenValidation, validateUserRole(USER), ...notificationMedicationNotificationIdValidator, ...notificationMedicationListValidator, validateFields, getNotificationMedicationsByNotification);

// Get Notification Medication by ID
// Code: ESAVI-NOTIFMED-003
// Declared after every literal path so Express does not capture 'case', 'admin', 'notification',
// 'purge' or 'activate' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationMedicationIdValidator, validateFields, getNotificationMedicationById);

// Update Notification Medication
// Code: ESAVI-NOTIFMED-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicationIdValidator, ...updateNotificationMedicationValidator, validateFields, updateNotificationMedication);

// Delete Notification Medication - Logical delete
// Code: ESAVI-NOTIFMED-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationMedicationIdValidator, validateFields, deleteNotificationMedication);

export default router;
