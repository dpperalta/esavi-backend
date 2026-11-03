import { Router } from 'express';
import { tokenValidation, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { getPendingWork } from '../controllers/dashboard.controller';

const { USER } = ROLES;

const router = Router();

// Get Dashboard Pending Work
// Code: ESAVI-DASH-006
router.get('/pending-work', tokenValidation, validateUserRole(USER), getPendingWork);

export default router;
