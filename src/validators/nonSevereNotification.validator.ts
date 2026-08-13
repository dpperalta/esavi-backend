import { body, param } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the notificationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its header — so the param is named :id only for uniformity with the
// rest of the routes of the repository
export const nonSevereNotificationIdValidator = [
    param('id').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NSEVNOT-006, which walks case -> notification -> detail
export const nonSevereNotificationCaseIdValidator = [
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
// The three foreign keys are only checked for shape here. Whether they exist, are active and
// belong to what they must belong to is resolved against the database in the service, which is
// also the only place that knows the stored value and can tell a change from a resend.
//
// The other source rule is not checked here either: on update it is evaluated over the resulting
// state, the stored row merged with the body, which the validator does not see. It lives in the
// service and answers 400 too. That is also why the description is not required to be non-empty
// here — a blank description under YES is the service's OTHER_SOURCE_DESCRIPTION_REQUIRED, not a
// shape error
export const createNonSevereNotificationValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid()
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('vaccinationHealthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Health Facility ID must be a valid UUID').trim(),
    body('vaccinationSiteItemId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Site Item ID must be a valid UUID').trim(),
    // The only column of the table with a declared maximum length. Checking it here turns a
    // Postgres 22001 into a readable 400
    body('vaccinationCenterAddress').optional({ nullable: true }).isString()
        .withMessage('Vaccination Center Address must be a string')
        .isLength({ max: 250 }).withMessage('Vaccination Center Address must be at most 250 characters long'),
    body('vaccinationGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Geo Location ID must be a valid UUID').trim(),
    body('verifiedPhysicalDocument').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Physical Document must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedElectronicRecord').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Electronic Record must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedVerbalReport').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Verbal Report must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedClinicalRecord').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Clinical Record must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedUnknown').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Unknown must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedOtherSource').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Other Source must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('otherSourceDescription').optional({ nullable: true }).isString()
        .withMessage('Other Source Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// notificationId is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason
export const updateNonSevereNotificationValidator = [
    body('vaccinationHealthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Health Facility ID must be a valid UUID').trim(),
    body('vaccinationSiteItemId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Site Item ID must be a valid UUID').trim(),
    body('vaccinationCenterAddress').optional({ nullable: true }).isString()
        .withMessage('Vaccination Center Address must be a string')
        .isLength({ max: 250 }).withMessage('Vaccination Center Address must be at most 250 characters long'),
    body('vaccinationGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Vaccination Geo Location ID must be a valid UUID').trim(),
    body('verifiedPhysicalDocument').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Physical Document must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedElectronicRecord').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Electronic Record must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedVerbalReport').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Verbal Report must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedClinicalRecord').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Clinical Record must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedUnknown').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Unknown must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('verifiedOtherSource').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Verified Other Source must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('otherSourceDescription').optional({ nullable: true }).isString()
        .withMessage('Other Source Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
