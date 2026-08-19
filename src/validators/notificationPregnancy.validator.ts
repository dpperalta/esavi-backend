import { body, param } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

export const notificationPregnancyIdValidator = [
    param('id').notEmpty().withMessage('Notification Pregnancy ID is required')
        .isUUID().withMessage('Notification Pregnancy ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-NOTIFPRG-006. It is the notificationId, not a pregnancy id, so it carries its
// own message and its own name in the route: /notification/:notificationId
export const notificationPregnancyNotificationIdValidator = [
    param('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID')
        .trim()
];

// No listing validator exists in this file, and that is not an omission: the relation is one to one,
// there is no ESAVI-NOTIFPRG-002 in any form, and the 006 returns a single object with no pagination.
//
// wasPregnantAtVaccination is the only field demanded here, and it is demanded with exists() plus
// isIn(): the answer is required, not a particular content. NO, UNKNOWN and NO_ANSWER are all valid,
// because demanding YES would turn the table into a register of confirmed pregnancies and lose the
// case that matters most - vaccinating someone whose pregnancy was unknown. A null sent explicitly
// fails the isIn(), which is what makes the field required and not merely present.
//
// The gestational range rule is not checked here even though both dates are in the body: on update
// it is evaluated over the resulting state, the stored row merged with what arrives, which the
// validator does not see. Keeping it in one place - the service - is what stops the create and the
// update from drifting apart.
//
// The female sex rule is not here either: it needs the patient of the case and the systemConfig row,
// and both are database reads.
//
// notes carries no maximum length because the DDL column is `text`, with no width to overflow
export const createNotificationPregnancyValidator = [
    body('notificationId').notEmpty().withMessage('Notification ID is required')
        .isUUID().withMessage('Notification ID must be a valid UUID').trim(),
    body('wasPregnantAtVaccination').exists().withMessage('Was Pregnant At Vaccination is required')
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Was Pregnant At Vaccination must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('wasPregnantAtEsavi').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Was Pregnant At Esavi must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    // Calendar dates, checked as plain YYYY-MM-DD strings
    body('lastMenstruationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Last Menstruation Date must be a valid ISO 8601 date'),
    body('probableDeliveryDate').optional({ nullable: true }).isISO8601()
        .withMessage('Probable Delivery Date must be a valid ISO 8601 date'),
    body('hasComplications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Complications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// notificationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for
// no reason.
//
// wasPregnantAtVaccination becomes optional and nullable here, and the asymmetry with the create is
// deliberate. The create guarantees the row is born informed; the update exists to correct, and a
// notifier who answered by mistake has to be able to withdraw the answer without losing the
// pregnancyId and its whole audit trail. Forcing a 005A and a new create instead would destroy both
export const updateNotificationPregnancyValidator = [
    body('wasPregnantAtVaccination').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Was Pregnant At Vaccination must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('wasPregnantAtEsavi').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Was Pregnant At Esavi must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('lastMenstruationDate').optional({ nullable: true }).isISO8601()
        .withMessage('Last Menstruation Date must be a valid ISO 8601 date'),
    body('probableDeliveryDate').optional({ nullable: true }).isISO8601()
        .withMessage('Probable Delivery Date must be a valid ISO 8601 date'),
    body('hasComplications').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Complications must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
