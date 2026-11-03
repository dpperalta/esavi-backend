import { DashboardActivityAction, DashboardAgeBand } from '../types';

export const DASHBOARD_CONFIG_SCOPE = 'DASHBOARD';
export const DASHBOARD_STALE_DAYS_CODE = 'ESAVI_DASHBOARD_STALE_DAYS';
export const DASHBOARD_TOP_LIMIT = 10;
export const DASHBOARD_DEFAULT_PERIOD_DAYS = 30;
export const DASHBOARD_MAX_PERIOD_DAYS = 366;
export const NOTIFICATION_CONFIG_SCOPE = 'NOTIFICATION';
export const NOTIFICATION_DEADLINE_DAYS_CODE = 'ESAVI_NOTIFICATION_DEADLINE_DAYS';
export const DASHBOARD_VACCINE_TOP_LIMIT = 10;
export const DASHBOARD_BATCH_ALERT_LIMIT = 50;
export const DASHBOARD_BATCH_MIN_CASES_CODE = 'ESAVI_DASHBOARD_BATCH_MIN_CASES';
export const DASHBOARD_BATCH_MIN_CASES_DEFAULT = 3;
export const DASHBOARD_BATCH_MIN_SERIOUS_CODE = 'ESAVI_DASHBOARD_BATCH_MIN_SERIOUS';
export const DASHBOARD_BATCH_MIN_SERIOUS_DEFAULT = 2;
export const DASHBOARD_ACTIVITY_WINDOW_DAYS = 30;
export const DASHBOARD_ACTIVITY_LIMIT = 20;
export const DASHBOARD_MY_CASES_LIMIT = 10;
export const DASHBOARD_ACTIVITY_EXCLUDED_METHODS: readonly string[] = [ 'ESAVI-CASEFLOW-001' ];

export const DASHBOARD_ACTIVITY_ACTION_MAP: Readonly<Record<string, DashboardActivityAction>> = {
    'ESAVI-CASE-001': 'CASE_CREATED',
    'ESAVI-CASE-004': 'CASE_UPDATED',
    'ESAVI-CASE-005A': 'CASE_DEACTIVATED',
    'ESAVI-CASE-005B': 'CASE_ACTIVATED',
    'ESAVI-CASEFLOW-005A': 'WORKFLOW_DEACTIVATED',
    'ESAVI-CASEFLOW-005B': 'WORKFLOW_ACTIVATED',
    'ESAVI-CASEFLOW-007': 'STAGE_COMPLETED',
    'ESAVI-CASEFLOW-008': 'CASE_CLOSED',
    'ESAVI-CASEFLOW-009': 'CASE_REOPENED',
    'ESAVI-CASEFLOW-010': 'VALIDATION_REQUESTED',
    'ESAVI-CASEFLOW-011': 'VALIDATION_RESOLVED',
    'ESAVI-CASEFLOW-012': 'STAGE_STARTED'
};

export const DASHBOARD_AGE_BANDS: readonly DashboardAgeBand[] = [
    { code: 'LT_1Y', minYears: 0, maxYears: 0 },
    { code: 'Y1_17', minYears: 1, maxYears: 17 },
    { code: 'Y18_24', minYears: 18, maxYears: 24 },
    { code: 'Y25_49', minYears: 25, maxYears: 49 },
    { code: 'Y50_59', minYears: 50, maxYears: 59 },
    { code: 'Y60_69', minYears: 60, maxYears: 69 },
    { code: 'Y70_79', minYears: 70, maxYears: 79 },
    { code: 'Y80_PLUS', minYears: 80, maxYears: null },
    { code: 'UNKNOWN', minYears: null, maxYears: null }
];

export const DASHBOARD_SEX_CODES = [ 'FEMALE', 'MALE', 'UNKNOWN', 'NONE' ] as const;
