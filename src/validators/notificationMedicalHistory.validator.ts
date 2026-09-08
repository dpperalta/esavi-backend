import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

export const notificationMedicalHistoryIdValidator = [
    param('id').notEmpty().withMessage('Medical History ID is required')
        .isUUID().withMessage('Medical History ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-MEDHIST-002A and 002B. It is the
// notificationId, not a medical history id, so it carries its own message
export const notificationMedicalHistoryNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-MEDHIST-006, which enters by the case and not by the notification
export const notificationMedicalHistoryCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the three listings return every antecedent of their parent, and no
// filter by diagnosticTermId or text is in scope
export const notificationMedicalHistoryListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// Three fields are declared in no validator of this file. sortOrder is assigned by
// TRG_notificationMedicalHistory_setSortOrder and ignored in silence — answering 400 for a field a
// client may be resending whole from a GET is hostile, and the type does not carry it anyway.
// diagnosticTermId is never chosen by the client: it is what the resolution returns, and admitting
// it would open a second door to point at a term without going through historyCode. And historyRaw
// is derived, computed by the service against the master's name.
//
// historyCode and source are the two accepted fields that are not columns of this table. They
// govern which branch of the resolution against the clinical master is taken and are discarded
// afterwards: the code lives in diagnosticTerm.
//
// The maximum lengths are the ones of the DDL — 500 for the name, which is what historyRaw holds,
// and 100 for the code, which is what diagnosticTerm.code holds — so an overlong text is a readable
// 400 and not a Postgres 22001
export const createNotificationMedicalHistoryValidator = [
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('historyName').trim().notEmpty().withMessage('Medical History Name is required')
        .isLength({ max: 500 }).withMessage('Medical History Name must be at most 500 characters long'),
    body('historyCode').optional({ nullable: true }).isString()
        .withMessage('Medical History Code must be a string')
        .isLength({ max: 100 }).withMessage('Medical History Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// notificationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason.
//
// historyName is optional but *not nullable*, the same asymmetry SPEC F27 chose: an explicit null
// would erase the only text that identifies the antecedent and leave a row the 001 would have
// rejected. Correcting a wrong antecedent is done by sending the right text, not by erasing it.
// Since optional() only skips undefined, an explicit null falls through to notEmpty and answers
// 400. notes is nullable, as usual
export const updateNotificationMedicalHistoryValidator = [
    body('historyName').optional().trim().notEmpty().withMessage('Medical History Name cannot be empty')
        .isLength({ max: 500 }).withMessage('Medical History Name must be at most 500 characters long'),
    body('historyCode').optional({ nullable: true }).isString()
        .withMessage('Medical History Code must be a string')
        .isLength({ max: 100 }).withMessage('Medical History Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
