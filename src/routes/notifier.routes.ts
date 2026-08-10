import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import {
    activateNotifier,
    createNotifier,
    deleteNotifier,
    getAllNotifiers,
    getNotifierById,
    getNotifiers,
    updateNotifier
} from '../controllers/notifier.controller';
import { createNotifierValidator, notifierIdValidator, notifierListValidator, updateNotifierValidator } from '../validators';

const { SUPERADMIN, ADMIN, USER } = ROLES;

const router = Router();

// Create Notifier
// Code: ESAVI-NOTIFIER-001
// USER and not ADMIN, departing from the canonical matrix: the notifier is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotifierValidator, validateFields, createNotifier);

// Get Notifiers
// Code: ESAVI-NOTIFIER-002A
router.get('/', tokenValidation, validateUserRole(USER), ...notifierListValidator, validateFields, getNotifiers);

// Get All Notifiers - For Admin
// Code: ESAVI-NOTIFIER-002B
router.get('/admin', tokenValidation, validateUserRole(ADMIN), ...notifierListValidator, validateFields, getAllNotifiers);

// Activate Notifier - For SuperAdmin
// Code: ESAVI-NOTIFIER-005B
router.patch('/activate/:id', tokenValidation, validateUserRole(SUPERADMIN), ...notifierIdValidator, validateFields, activateNotifier);

// Get Notifier by ID
// Code: ESAVI-NOTIFIER-003
// Declared after the literal paths so Express does not capture 'admin' as an :id
router.get('/:id', tokenValidation, validateUserRole(USER), ...notifierIdValidator, validateFields, getNotifierById);

// Update Notifier
// Code: ESAVI-NOTIFIER-004
// USER for the same reason as 001: correcting the notifier is part of reporting the ESAVI
router.put('/:id', tokenValidation, validateUserRole(USER), ...notifierIdValidator, ...updateNotifierValidator, validateFields, updateNotifier);

// Soft delete Notifier
// Code: ESAVI-NOTIFIER-005A
router.delete('/:id', tokenValidation, validateUserRole(ADMIN), ...notifierIdValidator, validateFields, deleteNotifier);

export default router;
