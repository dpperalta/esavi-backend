import { Router } from 'express';
import { tokenValidation, validateFields, validateUserRole } from '../middlewares';
import { ROLES } from '../constants/roles.constants';
import { dashboardPeriodValidator } from '../validators';
import { getBatchAlerts, getDistributions, getEpiCurve, getIndicators, getPendingWork, getRecentActivity, getSystemActivity } from '../controllers/dashboard.controller';

const { USER, ANALYTICS, SUPERADMIN } = ROLES;

const router = Router();

// Get Dashboard Pending Work
// Code: ESAVI-DASH-006
router.get('/pending-work', tokenValidation, validateUserRole(USER), getPendingWork);

// Get Dashboard Indicators
// Code: ESAVI-DASH-007
router.get('/indicators', tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getIndicators);

// Get Dashboard Epi Curve
// Code: ESAVI-DASH-008
router.get('/epi-curve', tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getEpiCurve);

// Get Dashboard Distributions
// Code: ESAVI-DASH-009
router.get('/distributions', tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getDistributions);

// Get Dashboard Batch Alerts
// Code: ESAVI-DASH-010
router.get('/batch-alerts', tokenValidation, validateUserRole(ANALYTICS), ...dashboardPeriodValidator, validateFields, getBatchAlerts);

// Get Dashboard Recent Activity
// Code: ESAVI-DASH-011
router.get('/recent-activity', tokenValidation, validateUserRole(USER), getRecentActivity);

// Get Dashboard System Activity
// Code: ESAVI-DASH-012
router.get('/system-activity', tokenValidation, validateUserRole(SUPERADMIN), getSystemActivity);

export default router;
