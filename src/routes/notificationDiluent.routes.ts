import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    createNotificationDiluent,
    getAllNotificationDiluentsByVaccine,
    getNotificationDiluentById,
    getNotificationDiluentsByVaccine,
    updateNotificationDiluent
} from '../controllers/notificationDiluent.controller';
import {
    createNotificationDiluentValidator,
    notificationDiluentIdValidator,
    notificationDiluentListValidator,
    notificationDiluentVaccineIdValidator,
    updateNotificationDiluentValidator
} from '../validators';

const { ADMIN, USER } = ROLES;

const router = Router();

// The eight routes of this entity are declared in a fixed order: the four literal paths —
// /admin/vaccine, /vaccine, /purge and /activate — go before /:id, or Express would capture them as
// an :id and the UUID validator would answer 400

// Create Notification Diluent
// Code: ESAVI-NOTIFDIL-001
router.post('/', tokenValidation, validateUserRole(ADMIN), ...createNotificationDiluentValidator, validateFields, createNotificationDiluent);

// Get All Notification Diluents By Vaccine - For Admin
// Code: ESAVI-NOTIFDIL-002B
// Two distinct routes and not one GET branching by role, which is why each one carries its own
// letter in the five places: they also differ in the minimum role
router.get('/admin/vaccine/:id', tokenValidation, validateUserRole(ADMIN), ...notificationDiluentVaccineIdValidator, ...notificationDiluentListValidator, validateFields, getAllNotificationDiluentsByVaccine);

// Get Active Notification Diluents By Vaccine
// Code: ESAVI-NOTIFDIL-002A
// The :id is the vaccineId, not a diluent id: the listing is entered by the foreign key. Declared
// after /admin/vaccine/:id, which is the more specific literal path
router.get('/vaccine/:id', tokenValidation, validateUserRole(USER), ...notificationDiluentVaccineIdValidator, ...notificationDiluentListValidator, validateFields, getNotificationDiluentsByVaccine);

// Get Notification Diluent by ID
// Code: ESAVI-NOTIFDIL-003
// Declared after every literal path: an /:id first would swallow /admin, /vaccine, /purge and
// /activate, and the UUID validator would answer 400 for routes that do exist
router.get('/:id', tokenValidation, validateUserRole(USER), ...notificationDiluentIdValidator, validateFields, getNotificationDiluentById);

// Update Notification Diluent
// Code: ESAVI-NOTIFDIL-004
router.put('/:id', tokenValidation, validateUserRole(ADMIN), ...notificationDiluentIdValidator, ...updateNotificationDiluentValidator, validateFields, updateNotificationDiluent);

export default router;
