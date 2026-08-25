import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// The ceiling of a Postgres smallint. It is not in any CHECK of the DDL — the four CHECK constraints
// only cover the floor with >= 0 — it belongs to the column type, and nothing replicates it unless
// the validator does. Without it a 40000 reaches Postgres and comes back as a 500 from a type
// overflow instead of a readable 400
const SMALLINT_MAX = 32767;

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVVACTX-005C
export const investigationVaccinationContextIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVVACTX-006, which walks case -> investigation -> vaccination context
export const investigationVaccinationContextCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource, investigationAutopsy,
// investigationMedicalHistory and investigationClinicalEvaluation: the visibility comes from
// investigation.isActive, so 002A and 002B return different sets. The two filters are accumulative
// with AND and by equality — investigationId over the primary key itself, caseId over the where of
// the investigation include, which travels in the query anyway.
// There is no filter by isCluster: filtering by a domain value would be the first of the repository
// and opens the door to dashboards, which SPEC F36 §2 leaves out. And there is no text search over
// locations, clusterIdentificationNumber nor notes
export const investigationVaccinationContextListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The two catalog foreign keys are checked for shape only. That an item exists, is active and
// belongs to vaccinationMoment is the double hop of the service, which answers 404 — the validator
// cannot reach the database.
//
// isCluster and clusterUsedSameVial stay optional and nullable, which is what keeps their five-value
// answer alive: null is "the form did not collect it" and 'NO_ANSWER' is "it was asked and not
// answered". They are different data and neither is normalized into the other, as SPEC F13 fixed.
//
// The four counters carry min: 0 and max: SMALLINT_MAX. The floor replicates the four CHECK
// constraints of the DDL and the ceiling replicates the smallint type. 0 PASSES and must keep
// passing: "nobody else was vaccinated from that vial" is a real answer, not an absence.
//
// clusterIdentificationNumber is the only varchar(n) of the table, so it is the only text with a
// maximum length here; locations and notes are text in the DDL and carry none.
//
// NEITHER THE CLUSTER BLOCK RULE NOR THE SHARED VIAL RULE IS CHECKED HERE: both are evaluated over
// the resulting state — on update the stored row merged with the body — which the validator does not
// see. They live in the service and answer 400 too. What lives here is the shape
const dataFieldValidators = [
    body('momentItemId').optional({ nullable: true })
        .isUUID().withMessage('Moment Item ID must be a valid UUID').trim(),
    body('multidoseItemId').optional({ nullable: true })
        .isUUID().withMessage('Multidose Item ID must be a valid UUID').trim(),
    body('vaccinatedPerVialCount').optional({ nullable: true })
        .isInt({ min: 0, max: SMALLINT_MAX })
        .withMessage(`Vaccinated Per Vial Count must be an integer between 0 and ${ SMALLINT_MAX }`),
    body('vaccinatedPerBatchCount').optional({ nullable: true })
        .isInt({ min: 0, max: SMALLINT_MAX })
        .withMessage(`Vaccinated Per Batch Count must be an integer between 0 and ${ SMALLINT_MAX }`),
    body('locations').optional({ nullable: true }).isString()
        .withMessage('Locations must be a string'),
    // The key of the cluster block. It is validated for shape like any other answerOption: which
    // values open the block and which close it is decided by the service, over the resulting state
    body('isCluster').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Is Cluster must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('clusterIdentificationNumber').optional({ nullable: true }).isString()
        .withMessage('Cluster Identification Number must be a string')
        .isLength({ max: 100 }).withMessage('Cluster Identification Number must be at most 100 characters'),
    body('clusterAdditionalCaseCount').optional({ nullable: true })
        .isInt({ min: 0, max: SMALLINT_MAX })
        .withMessage(`Cluster Additional Case Count must be an integer between 0 and ${ SMALLINT_MAX }`),
    body('clusterUsedSameVial').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Cluster Used Same Vial must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('clusterSameVialCount').optional({ nullable: true })
        .isInt({ min: 0, max: SMALLINT_MAX })
        .withMessage(`Cluster Same Vial Count must be an integer between 0 and ${ SMALLINT_MAX }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the eleven data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the eleven in null.
// The row opens as a draft and gets completed by the PUT
export const createInvestigationVaccinationContextValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationVaccinationContextValidator = [
    ...dataFieldValidators
];
