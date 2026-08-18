import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationDiluent,
    getNotificationDiluentsByVaccine
} from '../controllers/notificationDiluent.controller';
import {
    createNotificationDiluentValidator,
    notificationDiluentListValidator,
    notificationDiluentVaccineIdValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/vaccine, /vaccine, /purge and /activate — go before /:id, or Express would capture them as
// an :id and the UUID validator would answer 400

// Create Notification Diluent
// Code: ESAVI-NOTIFDIL-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationDiluentValidator, validateFields, createNotificationDiluent);

// Get Active Notification Diluents By Vaccine
// Code: ESAVI-NOTIFDIL-002A
// The :id is the vaccineId, not a diluent id: the listing is entered by the foreign key. It will be
// declared after /admin/vaccine/:id, which is the more specific literal path
router.get('/vaccine/:id', tokenValidation, validateUserRole(USER), ...notificationDiluentVaccineIdValidator, ...notificationDiluentListValidator, validateFields, getNotificationDiluentsByVaccine);

export default router;
