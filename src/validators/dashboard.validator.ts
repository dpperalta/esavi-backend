import { CustomValidator, query } from 'express-validator';
import { DASHBOARD_MAX_PERIOD_DAYS } from '../constants/dashboard.constants';
import { getMessage, isDashboardIsoDate, resolveDashboardPeriod } from '../helpers';

const isWithinDashboardLimits: CustomValidator = (_value, { req }): boolean => {
    const { from, to } = req.query ?? {};
    if( from !== undefined && !isDashboardIsoDate(from) ) return true;
    if( to !== undefined && !isDashboardIsoDate(to) ) return true;
    try {
        resolveDashboardPeriod({ from: from as string | undefined, to: to as string | undefined });
        return true;
    } catch {
        return false;
    }
}

export const dashboardPeriodValidator = [
    query('from').optional()
        .isISO8601({ strict: true }).withMessage('From must be a valid ISO 8601 date')
        .custom(isDashboardIsoDate).withMessage('From must be a date in YYYY-MM-DD format'),
    query('to').optional()
        .isISO8601({ strict: true }).withMessage('To must be a valid ISO 8601 date')
        .custom(isDashboardIsoDate).withMessage('To must be a date in YYYY-MM-DD format'),
    query('geoLocationId').optional()
        .isUUID().withMessage('Geo Location ID must be a valid UUID'),
    query('period')
        .custom(isWithinDashboardLimits)
        .withMessage((_value, { req }) =>
            getMessage('dashboard.invalidPeriod', req.lang, { maxDays: DASHBOARD_MAX_PERIOD_DAYS }))
];
