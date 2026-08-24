import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVMEDH-005C
export const investigationMedicalHistoryIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVMEDH-006, which walks case -> investigation -> medical history
export const investigationMedicalHistoryCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource and investigationAutopsy: the visibility
// comes from investigation.isActive, so 002A and 002B return different sets. The two filters are
// accumulative with AND and by equality — investigationId over the primary key itself, caseId over
// the where of the investigation include, which travels in the query anyway. There is no filter by
// isPregnancyConfirmed nor by any other data column: filtering medical histories by a clinical
// answer is an analytics query, not an operational one
export const investigationMedicalHistoryListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The five answerOption columns stay optional and nullable, which is what keeps their tri-state
// alive: null is "the form did not collect it" and 'NO_ANSWER' is "it was asked and not answered".
// They are different data and neither is normalized into the other, as SPEC F13 and F25 fixed, so a
// client must be able to send either one. None of the four texts carries a maximum length: the four
// columns are text in the DDL, with no varchar(n) to replicate.
//
// The two range rules replicate the CHECK constraints of the DDL (esaviapp.sql:1045 and :1052) and
// live here because they need no stored state: validateFields answers them with 400 and
// common.validationError, so neither generates an i18n key of its own. Leaving them only in the
// database would turn a gestationalWeeks of 46 into a 500 integrity error instead of a readable 400.
//
// The rule of the pregnancy block is NOT checked here: it is evaluated over the resulting state —
// on update the stored row merged with the body — which the validator does not see. It lives in the
// service and answers 400 too. What lives here is the shape
const dataFieldValidators = [
    body('hasPriorHospitalizationHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Prior Hospitalization History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('priorHospitalizationObservations').optional({ nullable: true }).isString()
        .withMessage('Prior Hospitalization Observations must be a string'),
    body('hasFamilyHistory').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Family History must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('familyHistoryObservations').optional({ nullable: true }).isString()
        .withMessage('Family History Observations must be a string'),
    // The key of the pregnancy block. It is validated for shape like any other answerOption: what
    // it governs is decided by the service
    body('isPregnancyConfirmed').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Is Pregnancy Confirmed must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    // 0 is a valid value of the CHECK and has to pass: the range is BETWEEN 0 AND 45, not 1 AND 45
    body('gestationalWeeks').optional({ nullable: true })
        .isInt({ min: 0, max: 45 }).withMessage('Gestational Weeks must be an integer between 0 and 45'),
    body('gestationMethodItemId').optional({ nullable: true })
        .isUUID().withMessage('Gestation Method Item ID must be a valid UUID').trim(),
    body('deliveryItemId').optional({ nullable: true })
        .isUUID().withMessage('Delivery Item ID must be a valid UUID').trim(),
    body('birthItemId').optional({ nullable: true })
        .isUUID().withMessage('Birth Item ID must be a valid UUID').trim(),
    body('pregnancyOutcomeItemId').optional({ nullable: true })
        .isUUID().withMessage('Pregnancy Outcome Item ID must be a valid UUID').trim(),
    body('hasPregnancyRiskFactor').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Has Pregnancy Risk Factor must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('riskFactorDescription').optional({ nullable: true }).isString()
        .withMessage('Risk Factor Description must be a string'),
    // isFloat and not isDecimal: the column is numeric(8,2) and the only rule of the CHECK is that
    // it cannot be negative. 0 has to pass here too
    body('birthWeightGrams').optional({ nullable: true })
        .isFloat({ min: 0, max: 6000 }).withMessage('Birth Weight Grams must be a number between 0 and 6000'),
    body('wasBreastfed').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Was Breastfed must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the fifteen data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the fifteen in null.
// The row opens as a draft and gets completed by the PUT
export const createInvestigationMedicalHistoryValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationMedicalHistoryValidator = [
    ...dataFieldValidators
];
