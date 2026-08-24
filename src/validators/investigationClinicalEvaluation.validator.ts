import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVCLIEV-005C
export const investigationClinicalEvaluationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVCLIEV-006, which walks case -> investigation -> clinical evaluation
export const investigationClinicalEvaluationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource, investigationAutopsy and
// investigationMedicalHistory: the visibility comes from investigation.isActive, so 002A and 002B
// return different sets. The two filters are accumulative with AND and by equality —
// investigationId over the primary key itself, caseId over the where of the investigation include,
// which travels in the query anyway.
// There is no filter by suspectedChildAbuse, suspectedDomesticViolence nor receivedMedicalAttention:
// counting clinical evaluations by a suspicion is an analytics query, not an operational one. And
// there is no filter by clinicalDetailsPersonName and there never will be while it is encrypted:
// over a fixed-IV ciphertext only exact equality is possible, and no use case asks for it
export const investigationClinicalEvaluationListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// receivedMedicalAttention stays optional and nullable, which is what keeps its tri-state alive:
// null is "the form did not collect it" and 'NO_ANSWER' is "it was asked and not answered". They
// are different data and neither is normalized into the other, as SPEC F13 fixed, so a client must
// be able to send either one. It governs nothing beyond its own shape.
//
// The six booleans are nullable too, and that is not decoration: over a nullable boolean the "no"
// has three forms — false, null and absent — and false ("it was checked and no") is a different
// datum from null ("it was not checked"). Neither collapses into the other.
//
// None of the seven texts carries a maximum length: the seven columns are text in the DDL, with no
// varchar(n) to replicate. That includes clinicalDetailsPersonName, which the service encrypts:
// nothing here distinguishes it from the other six, because the validator sees the plain text.
//
// The DDL declares no CHECK on this table, so there is no range to replicate — the difference with
// SPEC F32, which had two.
//
// The rule of the three flag/explanation pairs is NOT checked here: it is evaluated over the
// resulting state — on update the stored row merged with the body — which the validator does not
// see. It lives in the service and answers 400 too. What lives here is the shape
const dataFieldValidators = [
    body('receivedMedicalAttention').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Received Medical Attention must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('sourceExam').optional({ nullable: true }).isBoolean()
        .withMessage('Source Exam must be a boolean'),
    body('sourceDocuments').optional({ nullable: true }).isBoolean()
        .withMessage('Source Documents must be a boolean'),
    body('sourceVerbalAutopsy').optional({ nullable: true }).isBoolean()
        .withMessage('Source Verbal Autopsy must be a boolean'),
    // The flag of pair 1. It is validated for shape like any other boolean: what it governs is
    // decided by the service, over the resulting state
    body('sourceOther').optional({ nullable: true }).isBoolean()
        .withMessage('Source Other must be a boolean'),
    body('otherDescription').optional({ nullable: true }).isString()
        .withMessage('Other Description must be a string'),
    body('suspectedChildAbuse').optional({ nullable: true }).isBoolean()
        .withMessage('Suspected Child Abuse must be a boolean'),
    body('childAbuseExplanation').optional({ nullable: true }).isString()
        .withMessage('Child Abuse Explanation must be a string'),
    body('suspectedDomesticViolence').optional({ nullable: true }).isBoolean()
        .withMessage('Suspected Domestic Violence must be a boolean'),
    body('domesticViolenceExplanation').optional({ nullable: true }).isString()
        .withMessage('Domestic Violence Explanation must be a string'),
    body('clinicalDetailsPersonName').optional({ nullable: true }).isString()
        .withMessage('Clinical Details Person Name must be a string'),
    body('familyClinicalDetails').optional({ nullable: true }).isString()
        .withMessage('Family Clinical Details must be a string'),
    body('completeClinicalSummary').optional({ nullable: true }).isString()
        .withMessage('Complete Clinical Summary must be a string'),
    body('signsAndSymptoms').optional({ nullable: true }).isString()
        .withMessage('Signs And Symptoms must be a string'),
    body('otherSocialBackground').optional({ nullable: true }).isString()
        .withMessage('Other Social Background must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the sixteen data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the sixteen in null.
// The row opens as a draft and gets completed by the PUT
export const createInvestigationClinicalEvaluationValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationClinicalEvaluationValidator = [
    ...dataFieldValidators
];
