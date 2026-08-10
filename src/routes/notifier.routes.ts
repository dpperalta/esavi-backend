import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { createNotifier } from '../controllers/notifier.controller';
import { createNotifierValidator } from '../validators';

const { USER } = ROLES;

const router = Router();

// Create Notifier
// Code: ESAVI-NOTIFIER-001
// USER and not ADMIN, departing from the canonical matrix: the notifier is captured in the same
// operational flow as the case, and with create in ADMIN the flow would break in half
router.post('/', tokenValidation, validateUserRole(USER), ...createNotifierValidator, validateFields, createNotifier);

export default router;
