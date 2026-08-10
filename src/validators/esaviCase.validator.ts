import { body, param, query } from 'express-validator';

// The three date columns are calendar dates, so they are compared as plain YYYY-MM-DD
// strings: building a Date would drag the server time zone into the comparison and could
// reject today or admit tomorrow depending on the offset
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

// The event cannot be later than the report. When `reportDate` does not travel in the body,
// there is nothing to compare against here: the service resolves it (today on create, the
// stored value on update) and re-checks the coherence against the resulting state
const isNotAfterReportDate = (value: string, reportDate: unknown): boolean => {
    if( reportDate === undefined || reportDate === null || reportDate === '' ) return true;
    return toIsoDay(value) <= toIsoDay(reportDate);
}

export const esaviCaseIdValidator = [
    param('id').notEmpty().withMessage('ESAVI Case ID is required')
        .isUUID().withMessage('ESAVI Case ID must be a valid UUID')
        .trim()
];

export const esaviCaseListValidator = [
    query('patientId').optional()
        .isUUID().withMessage('Patient ID must be a valid UUID').trim(),
    query('healthFacilityId').optional()
        .isUUID().withMessage('Health Facility ID must be a valid UUID').trim(),
    query('reportDateFrom').optional().isISO8601()
        .withMessage('Report Date From must be a valid ISO 8601 date'),
    query('reportDateTo').optional().isISO8601()
        .withMessage('Report Date To must be a valid ISO 8601 date'),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// `caseCode` is not validated in either direction: the service generates it on create and
// ignores it on update, so its presence in the body is never an input error
export const createEsaviCaseValidator = [
    body('patientId').notEmpty().withMessage('Patient ID is required')
        .isUUID().withMessage('Patient ID must be a valid UUID').trim(),
    body('healthFacilityId').notEmpty().withMessage('Health Facility ID is required')
        .isUUID().withMessage('Health Facility ID must be a valid UUID').trim(),
    body('reportDate').optional({ nullable: true }).isISO8601()
        .withMessage('Report Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Report Date cannot be in the future'),
    body('eventDate').optional({ nullable: true }).isISO8601()
        .withMessage('Event Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Event Date cannot be in the future')
        .custom((value, { req }) => isNotAfterReportDate(value, req.body?.reportDate))
        .withMessage('Event Date cannot be later than the Report Date'),
    body('reportFillingDate').optional({ nullable: true }).isISO8601()
        .withMessage('Report Filling Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Report Filling Date cannot be in the future'),
    body('countryIsoCode').optional({ nullable: true }).trim()
        .isLength({ min: 2, max: 5 }).withMessage('Country ISO Code must be between 2 and 5 characters long')
        .isAlpha().withMessage('Country ISO Code must contain only letters'),
    body('notificationOrganization').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Notification Organization must be at most 250 characters long'),
    body('details').optional({ nullable: true }).isString()
        .withMessage('Details must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];

export const updateEsaviCaseValidator = [
    body('patientId').optional()
        .isUUID().withMessage('Patient ID must be a valid UUID').trim(),
    body('healthFacilityId').optional()
        .isUUID().withMessage('Health Facility ID must be a valid UUID').trim(),
    body('reportDate').optional({ nullable: true }).isISO8601()
        .withMessage('Report Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Report Date cannot be in the future'),
    body('eventDate').optional({ nullable: true }).isISO8601()
        .withMessage('Event Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Event Date cannot be in the future')
        .custom((value, { req }) => isNotAfterReportDate(value, req.body?.reportDate))
        .withMessage('Event Date cannot be later than the Report Date'),
    body('reportFillingDate').optional({ nullable: true }).isISO8601()
        .withMessage('Report Filling Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Report Filling Date cannot be in the future'),
    body('countryIsoCode').optional({ nullable: true }).trim()
        .isLength({ min: 2, max: 5 }).withMessage('Country ISO Code must be between 2 and 5 characters long')
        .isAlpha().withMessage('Country ISO Code must contain only letters'),
    body('notificationOrganization').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Notification Organization must be at most 250 characters long'),
    body('details').optional({ nullable: true }).isString()
        .withMessage('Details must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];
