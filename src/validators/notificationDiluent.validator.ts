import { body, param, query } from 'express-validator';

// A time of day, with the seconds optional: the DDL column is `time`, and a form that only asks
// for hours and minutes must not need to invent ':00'. The service pads them before comparing, so
// a PUT resending '09:15' over a stored '09:15:00' does not count as a change
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const notificationDiluentIdValidator = [
    param('id').notEmpty().withMessage('Notification Diluent ID is required')
        .isUUID().withMessage('Notification Diluent ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-NOTIFDIL-002A and 002B. It is the vaccineId,
// not a diluent id, so it carries its own message
export const notificationDiluentVaccineIdValidator = [
    param('id').notEmpty().withMessage('Notification Vaccine ID is required')
        .isUUID().withMessage('Notification Vaccine ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the two listings return every diluent of their vaccine, and no
// filter by diluentCatalogId, batchNumber, dates or text over diluentName is in scope
export const notificationDiluentListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// sortOrder is declared in no validator of this file. It is assigned by
// TRG_notificationDiluent_setSortOrder and ignored in silence — answering 400 for a field a client
// may be resending whole from a GET is hostile, and the type does not carry it anyway.
//
// The minimum content guard — at least one of diluentCatalogId or diluentName — is not checked
// here: on update it is evaluated over the resulting state, the stored row merged with the body,
// which the validator does not see. It lives in the service and answers 400 too.
//
// The temporal coherence rule is not checked here either: it needs
// notificationVaccine.vaccinationDate, which is a database read.
//
// diluentName and diluentCode carry no format check: they are the copy of what the notifier
// transcribed from the vial, and there is no standard to impose over a transcription.
//
// The maximum lengths are the ones of the DDL — 250 in the three texts — so an overlong text is a
// readable 400 and not a Postgres 22001
export const createNotificationDiluentValidator = [
    body('vaccineId').notEmpty().withMessage('Notification Vaccine ID is required')
        .isUUID().withMessage('Notification Vaccine ID must be a valid UUID').trim(),
    body('diluentCatalogId').optional({ nullable: true }).isUUID()
        .withMessage('Diluent Catalog ID must be a valid UUID'),
    body('batchNumber').optional({ nullable: true }).isString()
        .withMessage('Batch Number must be a string')
        .isLength({ max: 250 }).withMessage('Batch Number must be at most 250 characters long'),
    // A calendar date, checked as a plain YYYY-MM-DD string
    body('expirationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Expiration Date must be a valid ISO 8601 date'),
    body('reconstitutionDate').optional({ nullable: true }).isISO8601()
        .withMessage('Reconstitution Date must be a valid ISO 8601 date'),
    body('reconstitutionTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Reconstitution Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('diluentName').optional({ nullable: true }).isString()
        .withMessage('Diluent Name must be a string')
        .isLength({ max: 250 }).withMessage('Diluent Name must be at most 250 characters long'),
    body('diluentCode').optional({ nullable: true }).isString()
        .withMessage('Diluent Code must be a string')
        .isLength({ max: 250 }).withMessage('Diluent Code must be at most 250 characters long'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// vaccineId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason.
//
// diluentName admits null here, unlike a required field would: clearing it is legitimate as long
// as the row keeps diluentCatalogId, and it is the service that decides by looking at the
// resulting state
export const updateNotificationDiluentValidator = [
    body('diluentCatalogId').optional({ nullable: true }).isUUID()
        .withMessage('Diluent Catalog ID must be a valid UUID'),
    body('batchNumber').optional({ nullable: true }).isString()
        .withMessage('Batch Number must be a string')
        .isLength({ max: 250 }).withMessage('Batch Number must be at most 250 characters long'),
    body('expirationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Expiration Date must be a valid ISO 8601 date'),
    body('reconstitutionDate').optional({ nullable: true }).isISO8601()
        .withMessage('Reconstitution Date must be a valid ISO 8601 date'),
    body('reconstitutionTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Reconstitution Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('diluentName').optional({ nullable: true }).isString()
        .withMessage('Diluent Name must be a string')
        .isLength({ max: 250 }).withMessage('Diluent Name must be at most 250 characters long'),
    body('diluentCode').optional({ nullable: true }).isString()
        .withMessage('Diluent Code must be a string')
        .isLength({ max: 250 }).withMessage('Diluent Code must be at most 250 characters long'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
