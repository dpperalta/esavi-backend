import { body, param } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the notificationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its header — so the param is named :id only for uniformity with the
// rest of the routes of the repository
export const severeNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-SEVNOT-006, which walks case -> notification -> detail
export const severeNotificationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// No list validator: this entity has no 002, 002A or 002B. Without an activity flag the two
// variants of the dual listing would return exactly the same rows.
//
// The ENUM values come from the shared constants file, never from literals written here: the
// model reads the same array, so the two cannot drift apart. Checking them here is mandatory and
// not defensive — an unknown value would reach Postgres as a 22P02 and surface as a 500.
//
// The pregnancy rule is not checked here: on update it is evaluated over the resulting state,
// the stored row merged with the body, which the validator does not see. It lives in the service
// and answers 400 too. That is also why the description is not required to be non-empty here —
// a blank description under YES is the service's PREGNANCY_DESCRIPTION_REQUIRED, not a shape error
export const createSevereNotificationValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid()
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('hasPreviousEventHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Previous Event History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToOtherVaccines').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Other Vaccines must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToMedications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Medications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToPreviousSameVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Previous Same Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasPregnancyComplications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Pregnancy Complications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('pregnancyComplicationsDescription').optional({ nullable: true }).isString()
        .withMessage('Pregnancy Complications Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// notificationId is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason
export const updateSevereNotificationValidator = [
    body('hasPreviousEventHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Previous Event History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToOtherVaccines').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Other Vaccines must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToMedications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Medications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasAllergyToPreviousSameVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Allergy To Previous Same Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('hasPregnancyComplications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Pregnancy Complications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('pregnancyComplicationsDescription').optional({ nullable: true }).isString()
        .withMessage('Pregnancy Complications Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
