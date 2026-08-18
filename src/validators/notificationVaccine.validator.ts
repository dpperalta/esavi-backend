import { body, param, query } from 'express-validator';

// A time of day, with the seconds optional: the DDL column is `time`, and a form that only asks
// for hours and minutes must not need to invent ':00'. The service pads them before comparing, so
// a PUT resending '14:30' over a stored '14:30:00' does not count as a change
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const notificationVaccineIdValidator = [
    param('id').notEmpty().withMessage('Notification Vaccine ID is required')
        .isUUID().withMessage('Notification Vaccine ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-NOTIFVAC-002A and 002B. It is the
// notificationId, not a vaccine id, so it carries its own message
export const notificationVaccineNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NOTIFVAC-006, which walks case -> notification -> vaccines
export const notificationVaccineCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the three listings return every vaccine of their notification, and
// no filter by isSuspected, vaccineWhodrugId, batchNumber, dates or text over vaccineName is in
// scope
export const notificationVaccineListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// sortOrder is declared in no validator of this file. It is assigned by
// TRG_notificationVaccine_setSortOrder and ignored in silence — answering 400 for a field a client
// may be resending whole from a GET is hostile, and the type does not carry it anyway.
//
// The minimum content guard — at least one of vaccineWhodrugId or vaccineName — is not checked
// here: on update it is evaluated over the resulting state, the stored row merged with the body,
// which the validator does not see. It lives in the service and answers 400 too.
//
// The temporal coherence rule is not checked here either: it needs esaviCase.eventDate, which is a
// database read.
//
// whoCode, vaccineCode and vaccineName carry no format check: they are the copy of what the
// notifier read on the vaccination card, and there is no standard to impose over a transcription.
//
// doseNumber carries no maximum: the DDL only imposes >= 0, and an invented ceiling would break a
// future booster schedule.
//
// The maximum lengths are the ones of the DDL, so an overlong text is a readable 400 and not a
// Postgres 22001
export const createNotificationVaccineValidator = [
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('vaccineWhodrugId').optional({ nullable: true }).isUUID()
        .withMessage('Vaccine WHODrug ID must be a valid UUID'),
    body('isSuspected').optional().isBoolean().withMessage('Is Suspected must be a boolean').toBoolean(),
    body('whoCode').optional({ nullable: true }).isString()
        .withMessage('WHO Code must be a string')
        .isLength({ max: 250 }).withMessage('WHO Code must be at most 250 characters long'),
    body('vaccineCode').optional({ nullable: true }).isString()
        .withMessage('Vaccine Code must be a string')
        .isLength({ max: 250 }).withMessage('Vaccine Code must be at most 250 characters long'),
    body('vaccineName').optional({ nullable: true }).isString()
        .withMessage('Vaccine Name must be a string')
        .isLength({ max: 500 }).withMessage('Vaccine Name must be at most 500 characters long'),
    // A calendar date, checked as a plain YYYY-MM-DD string
    body('vaccinationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Vaccination Date must be a valid ISO 8601 date'),
    body('vaccinationTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Vaccination Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('doseNumber').optional({ nullable: true }).isInt({ min: 0 })
        .withMessage('Dose Number must be a non-negative integer').toInt(),
    body('batchNumber').optional({ nullable: true }).isString()
        .withMessage('Batch Number must be a string')
        .isLength({ max: 100 }).withMessage('Batch Number must be at most 100 characters long'),
    body('expirationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Expiration Date must be a valid ISO 8601 date'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// notificationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason.
//
// vaccineName admits null here, unlike a required field would: clearing it is legitimate as long
// as the row keeps vaccineWhodrugId, and it is the service that decides by looking at the
// resulting state
export const updateNotificationVaccineValidator = [
    body('vaccineWhodrugId').optional({ nullable: true }).isUUID()
        .withMessage('Vaccine WHODrug ID must be a valid UUID'),
    body('isSuspected').optional().isBoolean().withMessage('Is Suspected must be a boolean').toBoolean(),
    body('whoCode').optional({ nullable: true }).isString()
        .withMessage('WHO Code must be a string')
        .isLength({ max: 250 }).withMessage('WHO Code must be at most 250 characters long'),
    body('vaccineCode').optional({ nullable: true }).isString()
        .withMessage('Vaccine Code must be a string')
        .isLength({ max: 250 }).withMessage('Vaccine Code must be at most 250 characters long'),
    body('vaccineName').optional({ nullable: true }).isString()
        .withMessage('Vaccine Name must be a string')
        .isLength({ max: 500 }).withMessage('Vaccine Name must be at most 500 characters long'),
    body('vaccinationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Vaccination Date must be a valid ISO 8601 date'),
    body('vaccinationTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Vaccination Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('doseNumber').optional({ nullable: true }).isInt({ min: 0 })
        .withMessage('Dose Number must be a non-negative integer').toInt(),
    body('batchNumber').optional({ nullable: true }).isString()
        .withMessage('Batch Number must be a string')
        .isLength({ max: 100 }).withMessage('Batch Number must be at most 100 characters long'),
    body('expirationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Expiration Date must be a valid ISO 8601 date'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
