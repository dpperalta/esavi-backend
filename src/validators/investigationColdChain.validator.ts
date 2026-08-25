import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVCOLD-005C
export const investigationColdChainIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVCOLD-006, which walks case -> investigation -> cold chain
export const investigationColdChainCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource, investigationAutopsy,
// investigationMedicalHistory, investigationClinicalEvaluation and investigationVaccinationContext:
// the visibility comes from investigation.isActive, so 002A and 002B return different sets. The two
// filters are accumulative with AND and by equality — investigationId over the primary key itself,
// caseId over the where of the investigation include, which travels in the query anyway.
// There is no filter by any domain column — deviation of range, container type, findings: filtering
// by a domain value would be the first of the repository and opens the door to dashboards, which
// SPEC F38 §2 leaves out. And there is no text search over the four free text columns
export const investigationColdChainListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// THE ASYMMETRY OF TYPES OF THE DDL, CHECKED AND NOT SMOOTHED OVER. The first two columns are
// boolean (esaviapp.sql:1177-1178) and the other eight are answerOption: the validator checks each
// one against what its column is, and translates nothing between them. Sending 'YES' to a boolean is
// a 400, and so is sending true to an answerOption.
//
// The ten stay optional and nullable, which is what keeps the whole scale alive: for the two
// booleans null is "it is not known" and false is "it was not monitored", and for the eight answers
// null is "the form did not collect it" while 'NO_ANSWER' is "it was asked and not answered". They
// are different data and neither is normalized into the other, as SPEC F13 fixed.
//
// transportTypeThermo is the only varchar(n) of the table, so it is the only text with a maximum
// length here; the other three free text columns are text in the DDL and carry none. There is no
// numeric column in this table, so there is no range check anywhere in this file.
//
// NEITHER THE STORAGE BLOCK RULE NOR THE TRANSPORT CONTAINER EXCLUSION IS CHECKED HERE: both are
// evaluated over the resulting state — on update the stored row merged with the body — which the
// validator does not see. The transport one additionally needs to know WHETHER THE KEY TRAVELLED,
// which is what separates a conflict from a relay, and express-validator cannot express that either.
// They live in the service and answer 400 too. What lives here is the shape
const dataFieldValidators = [
    // The key of the storage block. It is validated for shape like any other boolean: that only true
    // opens the block is decided by the service, over the resulting state
    body('storageTemperatureMonitored').optional({ nullable: true }).isBoolean()
        .withMessage('Storage Temperature Monitored must be a boolean'),
    body('storageRangeDeviation').optional({ nullable: true }).isBoolean()
        .withMessage('Storage Range Deviation must be a boolean'),
    body('storageProcedureFollowed').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Storage Procedure Followed must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('storageOtherObjectPresent').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Storage Other Object Present must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('storagePartiallyReconstitutedVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Storage Partially Reconstituted Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('storageVaccineNotUsable').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Storage Vaccine Not Usable must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('storageDiluentNotUsable').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Storage Diluent Not Usable must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('storageKeyFindings').optional({ nullable: true }).isString()
        .withMessage('Storage Key Findings must be a string'),
    // The two sides of the mutual exclusion. Each one is a well formed answerOption on its own; that
    // the two cannot result 'YES' at once is the rule of the service
    body('transportUsedThermos').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Transport Used Thermos must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    // The three columns whose name lies about their content: they describe the container that was
    // used — thermos OR cold pack — and belong to no conditional block. Nothing here ties them to
    // either flag, and nothing in the service does either
    body('transportSetInThermos').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Transport Set In Thermos must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('transportReturnedInThermos').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Transport Returned In Thermos must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('transportUsedColdPack').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Transport Used Cold Pack must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('transportTypeThermo').optional({ nullable: true }).isString()
        .withMessage('Transport Type Thermo must be a string')
        .isLength({ max: 250 }).withMessage('Transport Type Thermo must be at most 250 characters'),
    body('transportKeyFindings').optional({ nullable: true }).isString()
        .withMessage('Transport Key Findings must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the fifteen data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the fifteen in null.
// The row opens as a draft and gets completed by the PUT
export const createInvestigationColdChainValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationColdChainValidator = [
    ...dataFieldValidators
];
