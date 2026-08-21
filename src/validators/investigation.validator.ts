import { body, param, query } from 'express-validator';

// hospitalizationDate and investigationStartDate are calendar dates, so they are compared as plain
// YYYY-MM-DD strings: building a Date would drag the server time zone into the comparison and could
// reject today or admit tomorrow depending on the offset. Same criterion as esaviCase,
// classification, notification and patient, each of which keeps its own copy
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

export const investigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVESTGN-006, which reads by the foreign key and not by the primary one
export const investigationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The four filters of 002A and 002B, accumulated with AND and by equality. A filter carrying a
// UUID that does not exist is an empty search, not a missing resource: the service answers 200
// with count 0
export const investigationListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('statusItemId').optional()
        .isUUID().withMessage('Status Item ID must be a valid UUID').trim(),
    query('vaccinationHealthFacilityId').optional()
        .isUUID().withMessage('Vaccination Health Facility ID must be a valid UUID').trim(),
    query('vaccinationGeoLocationId').optional()
        .isUUID().withMessage('Vaccination Geo Location ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// Every data column of the table is nullable, so every field but caseId is optional({ nullable: true }):
// the client may send it, omit it or send it explicitly null. statusItemId is declared like the rest
// even though the service never stores it null — that fallback is a business rule, not a shape one.
// The two coordinates use the same .isDecimal({ decimal_digits: '0,7' }) as healthFacility, which is
// what keeps an eighth decimal from reaching Postgres as a numeric(10,7) overflow
export const createInvestigationValidator = [
    body('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    body('statusItemId').optional({ nullable: true })
        .isUUID().withMessage('Status Item ID must be a valid UUID').trim(),
    body('vaccinationSiteItemId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Site Item ID must be a valid UUID').trim(),
    body('vaccinationHealthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Health Facility ID must be a valid UUID').trim(),
    body('vaccinationGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Geo Location ID must be a valid UUID').trim(),
    body('hospitalizationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Hospitalization Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Hospitalization Date cannot be in the future'),
    body('investigationStartDate').optional({ nullable: true }).isISO8601()
        .withMessage('Investigation Start Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Investigation Start Date cannot be in the future'),
    body('vaccinationLatitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Vaccination Latitude must be a decimal number with up to 7 decimal places'),
    body('vaccinationLongitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Vaccination Longitude must be a decimal number with up to 7 decimal places'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// `caseId` is not declared here on purpose: the service ignores it, so answering 400 for a field
// the client may be resending whole from a previous GET is hostile for no reason
export const updateInvestigationValidator = [
    body('statusItemId').optional({ nullable: true })
        .isUUID().withMessage('Status Item ID must be a valid UUID').trim(),
    body('vaccinationSiteItemId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Site Item ID must be a valid UUID').trim(),
    body('vaccinationHealthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Health Facility ID must be a valid UUID').trim(),
    body('vaccinationGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Geo Location ID must be a valid UUID').trim(),
    body('hospitalizationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Hospitalization Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Hospitalization Date cannot be in the future'),
    body('investigationStartDate').optional({ nullable: true }).isISO8601()
        .withMessage('Investigation Start Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Investigation Start Date cannot be in the future'),
    body('vaccinationLatitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Vaccination Latitude must be a decimal number with up to 7 decimal places'),
    body('vaccinationLongitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Vaccination Longitude must be a decimal number with up to 7 decimal places'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
