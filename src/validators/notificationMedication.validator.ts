import { body, param, query } from 'express-validator';

export const notificationMedicationIdValidator = [
    param('id').notEmpty().withMessage('Notification Medication ID is required')
        .isUUID().withMessage('Notification Medication ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-NOTIFMED-002A and 002B. It is the
// notificationId, not a medication id, so it carries its own message
export const notificationMedicationNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NOTIFMED-006, which walks case -> notification -> medications
export const notificationMedicationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the three listings return every medication of their notification,
// and no filter by isOtherMedication, the two catalog keys, startDate or text over medicationName
// is in scope
export const notificationMedicationListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// sortOrder is declared in no validator of this file. It is assigned by
// TRG_notificationMedication_setSortOrder and ignored in silence — answering 400 for a field a
// client may be resending whole from a GET is hostile, and the type does not carry it anyway.
//
// The coherence rule of the "other" medication is not checked here: on update it is evaluated over
// the resulting state — the stored row merged with the body — which the validator does not see. It
// lives in the service and answers 400 too. That is also why otherMedicationText is not required
// to be non-empty here: a blank text under true is the service's
// NOTIFMED_001_OTHER_TEXT_REQUIRED, not a shape error.
//
// medicationCode carries no format check: there is no master behind the column and no standard to
// impose while none exists.
//
// The maximum lengths are the ones of the DDL, so an overlong text is a readable 400 and not a
// Postgres 22001
export const createNotificationMedicationValidator = [
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('medicationName').trim().notEmpty().withMessage('Medication Name is required')
        .isLength({ max: 250 }).withMessage('Medication Name must be at most 250 characters long'),
    body('medicationCode').optional({ nullable: true }).isString()
        .withMessage('Medication Code must be a string')
        .isLength({ max: 250 }).withMessage('Medication Code must be at most 250 characters long'),
    body('dose').optional({ nullable: true }).isString()
        .withMessage('Dose must be a string')
        .isLength({ max: 100 }).withMessage('Dose must be at most 100 characters long'),
    body('pharmaceuticalFormItemId').optional({ nullable: true }).isUUID()
        .withMessage('Pharmaceutical Form Item ID must be a valid UUID'),
    body('administrationRouteItemId').optional({ nullable: true }).isUUID()
        .withMessage('Administration Route Item ID must be a valid UUID'),
    // A calendar date, checked as a plain YYYY-MM-DD string
    body('startDate').optional({ nullable: true }).isISO8601()
        .withMessage('Start Date must be a valid ISO 8601 date'),
    body('isOtherMedication').optional().isBoolean().withMessage('Is Other Medication must be a boolean').toBoolean(),
    body('otherMedicationText').optional({ nullable: true }).isString()
        .withMessage('Other Medication Text must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// notificationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason
export const updateNotificationMedicationValidator = [
    body('medicationName').optional().trim().notEmpty().withMessage('Medication Name cannot be empty')
        .isLength({ max: 250 }).withMessage('Medication Name must be at most 250 characters long'),
    body('medicationCode').optional({ nullable: true }).isString()
        .withMessage('Medication Code must be a string')
        .isLength({ max: 250 }).withMessage('Medication Code must be at most 250 characters long'),
    body('dose').optional({ nullable: true }).isString()
        .withMessage('Dose must be a string')
        .isLength({ max: 100 }).withMessage('Dose must be at most 100 characters long'),
    body('pharmaceuticalFormItemId').optional({ nullable: true }).isUUID()
        .withMessage('Pharmaceutical Form Item ID must be a valid UUID'),
    body('administrationRouteItemId').optional({ nullable: true }).isUUID()
        .withMessage('Administration Route Item ID must be a valid UUID'),
    body('startDate').optional({ nullable: true }).isISO8601()
        .withMessage('Start Date must be a valid ISO 8601 date'),
    body('isOtherMedication').optional().isBoolean().withMessage('Is Other Medication must be a boolean').toBoolean(),
    body('otherMedicationText').optional({ nullable: true }).isString()
        .withMessage('Other Medication Text must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
