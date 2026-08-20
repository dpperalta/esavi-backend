import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

export const notificationPregnancyComplicationIdValidator = [
    param('id').notEmpty().withMessage('Pregnancy Complication ID is required')
        .isUUID().withMessage('Pregnancy Complication ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-PREGCOMP-002A and 002B. It is the
// pregnancyId, not a complication id, so it carries its own message
export const notificationPregnancyComplicationPregnancyIdValidator = [
    param('id').notEmpty().withMessage('Notification Pregnancy ID is required')
        .isUUID().withMessage('Notification Pregnancy ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the two listings return every complication of their pregnancy, and
// no filter by complicationTypeItemId, diagnosticTermId or text is in scope
export const notificationPregnancyComplicationListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// Four fields are declared in no validator of this file. sortOrder is assigned by
// TRG_notificationPregnancyComplication_setSortOrder and ignored in silence — answering 400 for a
// field a client may be resending whole from a GET is hostile, and the type does not carry it
// anyway. diagnosticTermId is never chosen by the client: it is what the resolution returns, and
// admitting it would open a second door to point at a term without going through complicationCode.
// complicationRawName is derived, computed by the service against the master's name. And metadata
// is out of scope in SPEC F27.
//
// complicationCode and source are the two accepted fields that are not columns of this table. They
// govern which branch of the resolution against the clinical master is taken and are discarded
// afterwards: the code lives in diagnosticTerm.
//
// The maximum lengths are the ones of the DDL — 500 for the name, which is what
// complicationRawName holds, and 100 for the code, which is what diagnosticTerm.code holds — so an
// overlong text is a readable 400 and not a Postgres 22001
export const createNotificationPregnancyComplicationValidator = [
    body('pregnancyId').notEmpty().withMessage('Notification Pregnancy ID is required')
        .isUUID().withMessage('Notification Pregnancy ID must be a valid UUID').trim(),
    // Required by the application even though the DDL declares the column nullable: a complication
    // that is not typed is neither aggregated nor counted
    body('complicationTypeItemId').notEmpty().withMessage('Complication Type Item ID is required')
        .isUUID().withMessage('Complication Type Item ID must be a valid UUID').trim(),
    body('complicationName').trim().notEmpty().withMessage('Complication Name is required')
        .isLength({ max: 500 }).withMessage('Complication Name must be at most 500 characters long'),
    body('complicationCode').optional({ nullable: true }).isString()
        .withMessage('Complication Code must be a string')
        .isLength({ max: 100 }).withMessage('Complication Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// pregnancyId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason.
//
// complicationTypeItemId and complicationName are optional but *not nullable*, and that is the
// asymmetry SPEC F27 chose against the one SPEC F25 applied to wasPregnantAtVaccination: there a
// mistaken *answer* was being withdrawn, which is a legitimate correction, while here an explicit
// null would clear a mandatory *classification* and leave rows in the database the 001 would have
// rejected. Correcting a wrong typing is done by sending the right one, not by erasing it. Since
// optional() only skips undefined, an explicit null falls through to isUUID and notEmpty and
// answers 400. notes is nullable, as usual
export const updateNotificationPregnancyComplicationValidator = [
    body('complicationTypeItemId').optional().notEmpty().withMessage('Complication Type Item ID cannot be empty')
        .isUUID().withMessage('Complication Type Item ID must be a valid UUID').trim(),
    body('complicationName').optional().trim().notEmpty().withMessage('Complication Name cannot be empty')
        .isLength({ max: 500 }).withMessage('Complication Name must be at most 500 characters long'),
    body('complicationCode').optional({ nullable: true }).isString()
        .withMessage('Complication Code must be a string')
        .isLength({ max: 100 }).withMessage('Complication Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
