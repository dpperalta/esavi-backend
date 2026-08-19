import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createNotificationPregnancy } from '../controllers/notificationPregnancy.controller';
import { createNotificationPregnancyValidator } from '../validators';

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

export default router;
