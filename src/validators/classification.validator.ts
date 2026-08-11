import { body, param, query } from 'express-validator';
import { findSeverityViolation, SEVERITY_VIOLATION_MESSAGES } from '../helpers/severity.helper';

// firstConsultationDate is a calendar date, so it is compared as a plain YYYY-MM-DD string:
// building a Date would drag the server time zone into the comparison and could reject today
// or admit tomorrow depending on the offset. Same criterion as esaviCase and patient
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

const isPresent = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

// age and ageUnitItemId travel together or not at all. A number without a unit is less useful
// than no number: it forces a guess, and whoever guesses will pick years
const isAgeAndUnitTogether = (body: Record<string, unknown> | undefined): boolean =>
    isPresent(body?.age) === isPresent(body?.ageUnitItemId);

export const classificationIdValidator = [
    param('id').notEmpty().withMessage('Classification ID is required')
        .isUUID().withMessage('Classification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-CLASSIF-006, which reads by the foreign key and not by the primary one
export const classificationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The three filters of 002A and 002B, accumulated with AND. isSeriousEvent admits only true or
// false: there is no query value for "not informed", and the admin listing already shows them all
export const classificationListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('isSeriousEvent').optional()
        .isBoolean().withMessage('Is Serious Event must be a boolean'),
    query('ageUnitItemId').optional()
        .isUUID().withMessage('Age Unit Item ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// age and ageUnitItemId are declared although the service ignores them whenever both dates
// exist: they are the fallback for when patient.birthDate or esaviCase.eventDate is missing.
// The three cross rules of the coherence matrix are checked here, over the body, because on
// create the body is the whole resulting state
export const createClassificationValidator = [
    body('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    body('age').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 }).withMessage('Age must be an integer between 0 and 32767'),
    body('ageUnitItemId').optional({ nullable: true })
        .isUUID().withMessage('Age Unit Item ID must be a valid UUID').trim(),
    body('age').custom((value, { req }) => isAgeAndUnitTogether(req.body))
        .withMessage('Age and Age Unit Item ID must be sent together or not at all'),
    body('firstConsultationDate').optional({ nullable: true }).isISO8601()
        .withMessage('First Consultation Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('First Consultation Date cannot be in the future'),
    body('isSeriousEvent').optional({ nullable: true }).isBoolean()
        .withMessage('Is Serious Event must be a boolean').toBoolean(),
    body('causedDeath').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Death must be a boolean').toBoolean(),
    body('causedDisability').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Disability must be a boolean').toBoolean(),
    body('causedCongenitalAnomaly').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Congenital Anomaly must be a boolean').toBoolean(),
    body('causedFetalDeath').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Fetal Death must be a boolean').toBoolean(),
    body('causedLifeThreatening').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Life Threatening must be a boolean').toBoolean(),
    body('causedHospitalization').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Hospitalization must be a boolean').toBoolean(),
    body('causedAbortion').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Abortion must be a boolean').toBoolean(),
    body('causedOtherCondition').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Other Condition must be a boolean').toBoolean(),
    body('otherSeriousConditionDescription').optional({ nullable: true }).isString()
        .withMessage('Other Serious Condition Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean(),
    // Declared without .optional() so the chain runs even when isSeriousEvent is absent, which
    // is precisely one of the three situations the matrix rejects
    body('isSeriousEvent').custom((value, { req }) => {
        const violation = findSeverityViolation(req.body ?? {});
        if( violation ) {
            throw new Error(SEVERITY_VIOLATION_MESSAGES[violation]);
        }
        return true;
    })
];

// `caseId` is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason.
// The coherence matrix is not checked here either: on update it is evaluated over the
// resulting state — the stored row merged with the body — and the validator does not see the
// row. That check lives in updateClassificationService, over the same pure predicate
export const updateClassificationValidator = [
    body('age').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 }).withMessage('Age must be an integer between 0 and 32767'),
    body('ageUnitItemId').optional({ nullable: true })
        .isUUID().withMessage('Age Unit Item ID must be a valid UUID').trim(),
    body('age').custom((value, { req }) => isAgeAndUnitTogether(req.body))
        .withMessage('Age and Age Unit Item ID must be sent together or not at all'),
    body('firstConsultationDate').optional({ nullable: true }).isISO8601()
        .withMessage('First Consultation Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('First Consultation Date cannot be in the future'),
    body('isSeriousEvent').optional({ nullable: true }).isBoolean()
        .withMessage('Is Serious Event must be a boolean').toBoolean(),
    body('causedDeath').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Death must be a boolean').toBoolean(),
    body('causedDisability').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Disability must be a boolean').toBoolean(),
    body('causedCongenitalAnomaly').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Congenital Anomaly must be a boolean').toBoolean(),
    body('causedFetalDeath').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Fetal Death must be a boolean').toBoolean(),
    body('causedLifeThreatening').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Life Threatening must be a boolean').toBoolean(),
    body('causedHospitalization').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Hospitalization must be a boolean').toBoolean(),
    body('causedAbortion').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Abortion must be a boolean').toBoolean(),
    body('causedOtherCondition').optional({ nullable: true }).isBoolean()
        .withMessage('Caused Other Condition must be a boolean').toBoolean(),
    body('otherSeriousConditionDescription').optional({ nullable: true }).isString()
        .withMessage('Other Serious Condition Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
