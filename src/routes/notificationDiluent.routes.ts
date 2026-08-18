import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationDiluent
} from '../controllers/notificationDiluent.controller';
import {
    createNotificationDiluentValidator
} from '../validators';

const { ADMIN } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/vaccine, /vaccine, /purge and /activate — go before /:id, or Express would capture them as
// an :id and the UUID validator would answer 400

// Create Notification Diluent
// Code: ESAVI-NOTIFDIL-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationDiluentValidator, validateFields, createNotificationDiluent);

export default router;
