import { body, CustomValidator, param, query } from 'express-validator';

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

// The three date columns of the listing, each one filterable by its exact value or by its
// From/To range. The two cross checks below are written once and applied to the three: doing
// it six times by hand is where the one comparing the wrong column slips in
const DATE_FILTER_COLUMNS = [
    { field: 'reportDate', label: 'Report Date' },
    { field: 'eventDate', label: 'Event Date' },
    { field: 'reportFillingDate', label: 'Report Filling Date' }
] as const;

// Applied on the exact form. Exact and range govern the same column and their combination has
// no obvious reading, so it is rejected instead of silently giving priority to one of the two.
// The exclusion is per column: `?reportDate=…&eventDateFrom=…` is a legitimate question
const hasNoRangeOfSameColumn = (field: string): CustomValidator => (_value, { req }) => {
    const filters = req.query ?? {};
    return filters[`${ field }From`] === undefined && filters[`${ field }To`] === undefined;
}

// Applied on the `To` end, so it only runs when the upper bound of the range travels. Filters
// do not inherit `isNotFutureDate`: a range left open upwards is a legitimate query
const isNotEarlierThanItsFrom = (field: string): CustomValidator => (value, { req }) => {
    const from = (req.query ?? {})[`${ field }From`];
    if( from === undefined ) return true;
    return toIsoDay(from) <= toIsoDay(value);
}

const dateFilterValidators = DATE_FILTER_COLUMNS.flatMap(({ field, label }) => [
    query(field).optional().isISO8601()
        .withMessage(`${ label } must be a valid ISO 8601 date`)
        .custom(hasNoRangeOfSameColumn(field))
        .withMessage(`${ label } cannot be combined with ${ label } From or ${ label } To`),
    query(`${ field }To`).optional()
        .custom(isNotEarlierThanItsFrom(field))
        .withMessage(`${ label } From cannot be later than ${ label } To`)
]);

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
    query('geoLocationId').optional()
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    query('eventDateFrom').optional().isISO8601()
        .withMessage('Event Date From must be a valid ISO 8601 date'),
    query('eventDateTo').optional().isISO8601()
        .withMessage('Event Date To must be a valid ISO 8601 date'),
    query('reportFillingDateFrom').optional().isISO8601()
        .withMessage('Report Filling Date From must be a valid ISO 8601 date'),
    query('reportFillingDateTo').optional().isISO8601()
        .withMessage('Report Filling Date To must be a valid ISO 8601 date'),
    ...dateFilterValidators,
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
