import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateNotificationPregnancyComplication,
    createNotificationPregnancyComplication,
    deleteNotificationPregnancyComplication,
    getAllNotificationPregnancyComplicationsByPregnancy,
    getNotificationPregnancyComplicationById,
    getNotificationPregnancyComplicationsByPregnancy,
    updateNotificationPregnancyComplication
} from '../controllers/notificationPregnancyComplication.controller';
import {
    createNotificationPregnancyComplicationValidator,
    notificationPregnancyComplicationIdValidator,
    notificationPregnancyComplicationListValidator,
    notificationPregnancyComplicationPregnancyIdValidator,
    updateNotificationPregnancyComplicationValidator
} from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/pregnancy, /pregnancy, /purge and /activate — go before /:id, or Express would capture them
// as an :id and the UUID validator would answer 400

// Create Notification Pregnancy Complication
// Code: ESAVI-PREGCOMP-001
// USER and not ADMIN, following the parent F25 and not F24: the complication is captured in the same
// pregnancy form as the parent row, and splitting the form between two roles would break the capture
// in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationPregnancyComplicationValidator, validateFields, createNotificationPregnancyComplication);

// Get All Notification Pregnancy Complications By Pregnancy - For Admin
// Code: ESAVI-PREGCOMP-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places: they also differ in the minimum role
router.get('/admin/pregnancy/:id', tokenValidation, validateUserRole(ADMIN), ...notificationPregnancyComplicationPregnancyIdValidator, ...notificationPregnancyComplicationListValidator, validateFields, getAllNotificationPregnancyComplicationsByPregnancy);

// Get Active Notification Pregnancy Complications By Pregnancy
// Code: ESAVI-PREGCOMP-002A
// The :id is the pregnancyId, not a complication id: the listing is entered by the foreign key.
// Declared after /admin/pregnancy/:id, which is the more specific literal path
router.get('/pregnancy/:id', tokenValidation, validateUserRole(USER), ...notificationPregnancyComplicationPregnancyIdValidator, ...notificationPregnancyComplicationListValidator, validateFields, getNotificationPregnancyComplicationsByPregnancy);

// Activate Notification Pregnancy Complication - For SuperAdmin
// Code: ESAVI-PREGCOMP-005B
// Declared with the literal paths, before /:id
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notificationPregnancyComplicationIdValidator, validateFields, activateNotificationPregnancyComplication);

// Get Notification Pregnancy Complication by ID
// Code: ESAVI-PREGCOMP-003
// Declared after every literal path: an /:id first would swallow /admin, /pregnancy, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationPregnancyComplicationIdValidator, validateFields, getNotificationPregnancyComplicationById);

// Update Notification Pregnancy Complication
// Code: ESAVI-PREGCOMP-004
router.put('/:id', tokenValidation, validateUserRole(USER), ...notificationPregnancyComplicationIdValidator, ...updateNotificationPregnancyComplicationValidator, validateFields, updateNotificationPregnancyComplication);

// Delete Notification Pregnancy Complication - Soft delete
// Code: ESAVI-PREGCOMP-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationPregnancyComplicationIdValidator, validateFields, deleteNotificationPregnancyComplication);

export default router;
