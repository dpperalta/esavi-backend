import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createNotifier, getAllNotifiers, getNotifiers } from '../controllers/notifier.controller';
import { createNotifierValidator, notifierListValidator } from '../validators';

const { ADMIN, USER } = ROLES;

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

export default router;
