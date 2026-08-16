import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

// A time of day, with the seconds optional: the DDL column is `time`, and a form that only asks
// for hours and minutes must not need to invent ':00'
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const notificationEventIdValidator = [
    param('id').notEmpty().withMessage('Notification Event ID is required')
        .isUUID().withMessage('Notification Event ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-NOTIFEVT-002A and 002B. It is the
// notificationId, not an event id, so it carries its own message
export const notificationEventNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NOTIFEVT-006, which walks case -> notification -> events
export const notificationEventCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the three listings return every event of their notification, and
// no filter by isMainEsavi, diagnosticTermId, startDate or text over esaviName is in scope
export const notificationEventListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// sortOrder and diagnosticTermId are declared in no validator of this file. sortOrder is assigned
// by TRG_notificationEvent_setSortOrder and ignored in silence — answering 400 for a field a
// client may be resending whole from a GET is hostile, and the type does not carry it anyway.
// diagnosticTermId is never chosen by the client: it is what the resolution returns.
//
// source is the only accepted field that is not a column. It governs which branch of the
// resolution is taken and is discarded afterwards.
//
// The coherence rule of the "other" event is not checked here: on update it is evaluated over the
// resulting state — the stored row merged with the body — which the validator does not see. It
// lives in the service and answers 400 too. That is also why otherDescription is not required to
// be non-empty here: a blank description under true is the service's
// NOTIFEVT_001_OTHER_DESCRIPTION_REQUIRED, not a shape error.
//
// The maximum lengths are the ones of the DDL, so an overlong text is a readable 400 and not a
// Postgres 22001
export const createNotificationEventValidator = [
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('esaviName').trim().notEmpty().withMessage('ESAVI Name is required')
        .isLength({ max: 250 }).withMessage('ESAVI Name must be at most 250 characters long'),
    body('esaviCode').optional({ nullable: true }).isString()
        .withMessage('ESAVI Code must be a string')
        .isLength({ max: 250 }).withMessage('ESAVI Code must be at most 250 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('isMainEsavi').optional().isBoolean().withMessage('Is Main ESAVI must be a boolean').toBoolean(),
    // A calendar date, checked as a plain YYYY-MM-DD string
    body('startDate').optional({ nullable: true }).isISO8601()
        .withMessage('Start Date must be a valid ISO 8601 date'),
    body('startTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Start Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('isOtherEsavi').optional().isBoolean().withMessage('Is Other ESAVI must be a boolean').toBoolean(),
    body('otherDescription').optional({ nullable: true }).isString()
        .withMessage('Other Description must be a string')
        .isLength({ max: 500 }).withMessage('Other Description must be at most 500 characters long'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// notificationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason
export const updateNotificationEventValidator = [
    body('esaviName').optional().trim().notEmpty().withMessage('ESAVI Name cannot be empty')
        .isLength({ max: 250 }).withMessage('ESAVI Name must be at most 250 characters long'),
    body('esaviCode').optional({ nullable: true }).isString()
        .withMessage('ESAVI Code must be a string')
        .isLength({ max: 250 }).withMessage('ESAVI Code must be at most 250 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('isMainEsavi').optional().isBoolean().withMessage('Is Main ESAVI must be a boolean').toBoolean(),
    body('startDate').optional({ nullable: true }).isISO8601()
        .withMessage('Start Date must be a valid ISO 8601 date'),
    body('startTime').optional({ nullable: true }).matches(TIME_OF_DAY)
        .withMessage('Start Time must be a valid time in HH:MM or HH:MM:SS format'),
    body('isOtherEsavi').optional().isBoolean().withMessage('Is Other ESAVI must be a boolean').toBoolean(),
    body('otherDescription').optional({ nullable: true }).isString()
        .withMessage('Other Description must be a string')
        .isLength({ max: 500 }).withMessage('Other Description must be at most 500 characters long'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
