import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { dashboardPeriodValidator } from '../validators';
import { getIndicators, getPendingWork } from '../controllers/dashboard.controller';

const { USER, ANALYTICS } = ROLES;

const router = Router();

// Get Dashboard Pending Work
// Code: ESAVI-DASH-006
router.get('/pending-work', tokenValidation, validateUserRole(USER), getPendingWork);

// Get Dashboard Indicators
// Code: ESAVI-DASH-007
router.get('/indicators', tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getIndicators);

export default router;
