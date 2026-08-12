import { body, param, query } from 'express-validator';
import { NOTIFICATION_TYPES, ANSWER_OPTIONS } from '../constants/notification.constants';

// deathDate is a calendar date, so it is compared as a plain YYYY-MM-DD string: building a Date
// would drag the server time zone into the comparison and could reject today or admit tomorrow
// depending on the offset. Same criterion as esaviCase, patient and classification
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

const NOTIFICATION_TYPE_VALUES = [...NOTIFICATION_TYPES];
const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

export const notificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NOTIFCN-006, which reads by the foreign key and not by the primary one
export const notificationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The four filters of 002A and 002B, accumulated with AND and all by equality. notificationType
// is checked against the ENUM here so an unknown value answers 400 and never reaches Postgres,
// which would raise a 22P02 and surface as a 500
export const notificationListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('notificationType').optional()
        .isIn(NOTIFICATION_TYPE_VALUES).withMessage(`Notification Type must be one of: ${ NOTIFICATION_TYPES.join(', ') }`),
    query('requestInvestigation').optional()
        .isBoolean().withMessage('Request Investigation must be a boolean'),
    query('outcomeItemId').optional()
        .isUUID().withMessage('Outcome Item ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The ENUM values come from the constants file, never from literals written here: the model
// reads the same two arrays, so the two cannot drift apart.
// The death rule is not checked here — it depends on the code of the catalogItem behind
// outcomeItemId, which the validator cannot see. It lives in the service, and answers 400 too
export const createNotificationValidator = [
    body('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    body('notificationType').notEmpty().withMessage('Notification Type is required')
        .isIn(NOTIFICATION_TYPE_VALUES).withMessage(`Notification Type must be one of: ${ NOTIFICATION_TYPES.join(', ') }`),
    body('esaviDescription').trim().notEmpty().withMessage('ESAVI Description is required')
        .isString().withMessage('ESAVI Description must be a string'),
    body('hasRelevantMedicalHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Relevant Medical History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('takesMedication').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Takes Medication must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('outcomeItemId').optional({ nullable: true })
        .isUUID().withMessage('Outcome Item ID must be a valid UUID').trim(),
    // Declared without nullable: the field is never stored null, so sending it null is an error
    // and not a way to clear it
    body('requestInvestigation').optional()
        .isBoolean().withMessage('Request Investigation must be a boolean').toBoolean(),
    body('deathDate').optional({ nullable: true }).isISO8601()
        .withMessage('Death Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Death Date cannot be in the future'),
    body('autopsyRequested').optional({ nullable: true })
        .isBoolean().withMessage('Autopsy Requested must be a boolean').toBoolean(),
    body('verbalAutopsyPerformed').optional({ nullable: true })
        .isBoolean().withMessage('Verbal Autopsy Performed must be a boolean').toBoolean(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// caseId and notificationType are not declared here on purpose: the service ignores both, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile
// for no reason. The death rule is not checked here either — on update it is evaluated over the
// resulting state, the stored row merged with the body, which the validator does not see
export const updateNotificationValidator = [
    body('esaviDescription').optional().trim()
        .notEmpty().withMessage('ESAVI Description cannot be empty')
        .isString().withMessage('ESAVI Description must be a string'),
    body('hasRelevantMedicalHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Relevant Medical History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('takesMedication').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Takes Medication must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('outcomeItemId').optional({ nullable: true })
        .isUUID().withMessage('Outcome Item ID must be a valid UUID').trim(),
    body('requestInvestigation').optional()
        .isBoolean().withMessage('Request Investigation must be a boolean').toBoolean(),
    body('deathDate').optional({ nullable: true }).isISO8601()
        .withMessage('Death Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Death Date cannot be in the future'),
    body('autopsyRequested').optional({ nullable: true })
        .isBoolean().withMessage('Autopsy Requested must be a boolean').toBoolean(),
    body('verbalAutopsyPerformed').optional({ nullable: true })
        .isBoolean().withMessage('Verbal Autopsy Performed must be a boolean').toBoolean(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
