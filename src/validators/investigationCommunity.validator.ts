import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVCOMM-005C
export const investigationCommunityIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVCOMM-006, which walks case -> investigation -> community record
export const investigationCommunityCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource, investigationAutopsy,
// investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext,
// investigationColdChain and investigationAdministrationError: the visibility comes from
// investigation.isActive, so 002A and 002B return different sets. The two filters are accumulative
// with AND and by equality — investigationId over the primary key itself, caseId over the where of
// the investigation include, which travels in the query anyway.
// There is no filter by any domain column — the similar event flag, the four counters, the home
// coordinates: filtering by a domain value opens the door to dashboards, which SPEC F40 §2 leaves
// out, and filtering by the coordinates would be the first geospatial query of the repository. And
// there is no text search over the three free text columns
export const investigationCommunityListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// THE SHAPE OF THE TEN DATA COLUMNS, AND NOTHING ELSE. The ten stay optional and nullable, which is
// what keeps the whole scale alive: for hadSimilarEvent null is "the form did not collect it" while
// 'NO_ANSWER' is "it was asked and not answered", and neither is normalized into the other, as SPEC
// F13 fixed. The explicit null is also what lets the client erase a value already stored.
//
// NEITHER THE PROHIBITION NOR THE OBLIGATION OF THE SIMILAR EVENT BLOCK IS CHECKED HERE: both are
// evaluated over the resulting state — on update the stored row merged with the body — which the
// validator does not see. The prohibition additionally needs to know WHETHER THE FIELD TRAVELLED,
// which is what separates the 400 of the create from the forcing to null of the update, and
// express-validator cannot express that either. They live in the service and answer 400 too
const dataFieldValidators = [
    // THE GEOGRAPHIC RANGE IS REPLICATED EVEN THOUGH THE DDL DOES NOT DECLARE IT, and this is a
    // deliberate deviation from SPEC F28, which validates only the decimals over its own
    // coordinates. numeric(10,7) admits up to 999.9999999, so a latitude of 500 would enter without
    // a complaint from Postgres and be stored as an impossible home. isDecimal caps the scale so an
    // eighth decimal is a 400 here and not an error of the column; isFloat caps the value
    body('patientLatitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Patient Latitude must be a decimal number with up to 7 decimal places')
        .isFloat({ min: -90, max: 90 })
        .withMessage('Patient Latitude must be between -90 and 90'),
    body('patientLongitude').optional({ nullable: true })
        .isDecimal({ decimal_digits: '0,7' })
        .withMessage('Patient Longitude must be a decimal number with up to 7 decimal places')
        .isFloat({ min: -180, max: 180 })
        .withMessage('Patient Longitude must be between -180 and 180'),
    // The key of the similar event block. It is validated for shape like any other answerOption:
    // that only 'YES' opens the block is decided by the service, over the resulting state
    body('hadSimilarEvent').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Similar Event must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('similarEventDescription').optional({ nullable: true }).isString()
        .withMessage('Similar Event Description must be a string'),
    // THE FOUR CHECKS OF THE DDL, REPLICATED WITH THEIR smallint CEILING. The min is the
    // CHECK (... IS NULL OR ... >= 0) of esaviapp.sql:1245-1248; the max is the ceiling of the
    // column type, without which a 40000 would reach Postgres and come back as a 500 by type
    // overflow instead of a readable 400. It is the rule of SPEC F36.
    // The four stay optional even with the block open: the description is the minimum datum, the
    // counters are a breakdown the informant may not have. And they are NOT validated against each
    // other — the three affected* need not add up to similarEventCount
    body('similarEventCount').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Similar Event Count must be an integer between 0 and 32767'),
    body('affectedVaccinated').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Affected Vaccinated must be an integer between 0 and 32767'),
    body('affectedUnvaccinated').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Affected Unvaccinated must be an integer between 0 and 32767'),
    body('affectedUnknown').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Affected Unknown must be an integer between 0 and 32767'),
    // The three text columns carry NO isLength(): all three are text in the DDL and have no declared
    // ceiling, so notes of 5000 characters is a 201 and not a 400
    body('otherComments').optional({ nullable: true }).isString()
        .withMessage('Other Comments must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the ten data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the ten in null. The
// row opens as a draft and gets completed by the PUT
export const createInvestigationCommunityValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationCommunityValidator = [
    ...dataFieldValidators
];
