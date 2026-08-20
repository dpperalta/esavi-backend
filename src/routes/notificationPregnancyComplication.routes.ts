import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationPregnancyComplication
} from '../controllers/notificationPregnancyComplication.controller';
import {
    createNotificationPregnancyComplicationValidator
} from '../validators';

const { USER } = ROLES;

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

export default router;
