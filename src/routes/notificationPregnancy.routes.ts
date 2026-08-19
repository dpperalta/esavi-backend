import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationPregnancy,
    getNotificationPregnancyById
} from '../controllers/notificationPregnancy.controller';
import {
    createNotificationPregnancyValidator,
    notificationPregnancyIdValidator
} from '../validators';

const { USER } = ROLES;

const router = Router();

// The seven routes of this entity are declared in a fixed order: the three literal paths —
// /notification, /purge and /activate — go before /:id, or Express would capture them as an :id and
// the UUID validator would answer 400.
//
// There is no listing route in any form. The relation is one to one, so a listing would always
// return zero or one row, with a pagination that never paginates

// Create Notification Pregnancy
// Code: ESAVI-NOTIFPRG-001
// USER and not ADMIN, following the deviation the clinical detail entities fixed: the pregnancy
// section is captured in the same operational flow as the notification, and splitting it across two
// roles would break the form in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotificationPregnancyValidator, validateFields, createNotificationPregnancy);

// Get Notification Pregnancy by ID
// Code: ESAVI-NOTIFPRG-003
// Declared after every literal path: an /:id first would swallow /notification, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationPregnancyIdValidator, validateFields, getNotificationPregnancyById);

export default router;
