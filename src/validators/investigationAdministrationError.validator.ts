import { body, param, query } from 'express-validator';
import { ANSWER_OPTIONS } from '../constants/enums.constants';

const ANSWER_OPTION_VALUES = [...ANSWER_OPTIONS];

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVADMER-005C
export const investigationAdministrationErrorIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVADMER-006, which walks case -> investigation -> administration error
export const investigationAdministrationErrorCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource, investigationAutopsy,
// investigationMedicalHistory, investigationClinicalEvaluation, investigationVaccinationContext and
// investigationColdChain: the visibility comes from investigation.isActive, so 002A and 002B return
// different sets. The two filters are accumulative with AND and by equality — investigationId over
// the primary key itself, caseId over the where of the investigation include, which travels in the
// query anyway.
// There is no filter by any domain column — syringe type, reconstitution practice, any of the six
// concrete errors: filtering by a domain value would be the first of the repository and opens the
// door to dashboards, which SPEC F39 §2 leaves out. And there is no text search over the ten free
// text columns
export const investigationAdministrationErrorListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// THE ASYMMETRY OF TYPES OF THE DDL, CHECKED AND NOT SMOOTHED OVER. The four syringe types are
// boolean (esaviapp.sql:1204-1207) and the other twelve columns are answerOption — the flag that
// governs the four among them: the validator checks each one against what its column is, and
// translates nothing between them. Sending 'YES' to a boolean is a 400, and so is sending true to an
// answerOption.
//
// The sixteen stay optional and nullable, which is what keeps the whole scale alive: for the four
// booleans null is "it is not known" and false is "that type was not used", and for the twelve
// answers null is "the form did not collect it" while 'NO_ANSWER' is "it was asked and not
// answered". They are different data and neither is normalized into the other, as SPEC F13 fixed.
//
// NONE OF THE TEN TEXT COLUMNS CARRIES A MAXIMUM LENGTH, and that is the difference with
// investigationColdChain, whose transportTypeThermo was the only varchar(n) of its table. The ten
// here are text in the DDL, with no declared ceiling, and inventing one would create a 400 the
// database does not back. There is no numeric column in this table either, so there is no range
// check anywhere in this file.
//
// NEITHER THE SYRINGE BLOCK RULE NOR THE NESTED DESCRIPTION RULE IS CHECKED HERE: both are evaluated
// over the resulting state — on update the stored row merged with the body — which the validator
// does not see. Evaluating the minimum rule over the body would turn any partial PUT of a row with
// the block open into a 400, including one that only changes notes. They live in the service and
// answer 400 too. What lives here is the shape
const dataFieldValidators = [
    // The key of the syringe block. It is validated for shape like any other answerOption: THAT ONLY
    // 'NO' OPENS THE BLOCK is decided by the service, over the resulting state
    body('usedAutoDisableSyringes').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Used Auto Disable Syringes must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    // The four syringe types of the block. false is a value and not an absence here as well: it says
    // "syringes were used, but not of this type", and optional({ nullable: true }) lets it through
    // untouched
    body('usedGlassSyringes').optional({ nullable: true }).isBoolean()
        .withMessage('Used Glass Syringes must be a boolean'),
    body('usedDisposableSyringes').optional({ nullable: true }).isBoolean()
        .withMessage('Used Disposable Syringes must be a boolean'),
    body('usedRecycledDisposableSyringes').optional({ nullable: true }).isBoolean()
        .withMessage('Used Recycled Disposable Syringes must be a boolean'),
    // The fourth type, and the key of the nested block
    body('usedOtherSyringes').optional({ nullable: true }).isBoolean()
        .withMessage('Used Other Syringes must be a boolean'),
    // Governed by two chained conditions, and neither of them is checked here
    body('otherSyringesDescription').optional({ nullable: true }).isString()
        .withMessage('Other Syringes Description must be a string'),
    // Outside the block: nothing here ties it to the flag, and nothing in the service does either
    body('syringesKeyFindings').optional({ nullable: true }).isString()
        .withMessage('Syringes Key Findings must be a string'),
    // The five reconstitution columns. Each one is a well formed answerOption on its own, and there
    // is NO mutual exclusion between them: the five may result 'YES' at once
    body('reconstitutionUsedSameSyringe').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Reconstitution Used Same Syringe must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('reconstitutionUsedSameSyringeDifferentVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Reconstitution Used Same Syringe Different Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('reconstitutionUsedDifferentSyringeSameVial').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Reconstitution Used Different Syringe Same Vial must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('reconstitutionUsedDifferentSyringeDifferentVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Reconstitution Used Different Syringe Different Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('reconstitutionFollowedManufacturerRecommendation').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Reconstitution Followed Manufacturer Recommendation must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('reconstitutionKeyFindings').optional({ nullable: true }).isString()
        .withMessage('Reconstitution Key Findings must be a string'),
    // The six had* / *Notes pairs, twelve independent columns. NOTHING HERE TIES A NOTE TO ITS FLAG,
    // and nothing in the service does either: a 'NO' with the reason is a valid record
    body('hadPrescriptionError').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Prescription Error must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('prescriptionErrorNotes').optional({ nullable: true }).isString()
        .withMessage('Prescription Error Notes must be a string'),
    body('hadContaminatedVaccine').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Contaminated Vaccine must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('contaminatedVaccineNotes').optional({ nullable: true }).isString()
        .withMessage('Contaminated Vaccine Notes must be a string'),
    body('hadAbnormalVaccineConditions').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Abnormal Vaccine Conditions must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('abnormalConditionsNotes').optional({ nullable: true }).isString()
        .withMessage('Abnormal Conditions Notes must be a string'),
    body('hadPreparationError').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Preparation Error must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('preparationErrorNotes').optional({ nullable: true }).isString()
        .withMessage('Preparation Error Notes must be a string'),
    body('hadHandlingError').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Handling Error must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('handlingErrorNotes').optional({ nullable: true }).isString()
        .withMessage('Handling Error Notes must be a string'),
    body('hadImproperAdministration').optional({ nullable: true })
        .isIn(ANSWER_OPTION_VALUES).withMessage(`Had Improper Administration must be one of: ${ ANSWER_OPTIONS.join(', ') }`),
    body('improperAdministrationNotes').optional({ nullable: true }).isString()
        .withMessage('Improper Administration Notes must be a string'),
    // The observations of the whole row, always open
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is the only required field of the create, and the twenty six data columns are all
// optional: POST { investigationId } is a valid create that returns 201 with the twenty six in null.
// The row opens as a draft and gets completed by the PUT
export const createInvestigationAdministrationErrorValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid(), which is what
    // turns a create without it into a readable 400 instead of an integrity error of Postgres
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    ...dataFieldValidators
];

// investigationId is not declared here on purpose: the service ignores it always, so answering 400
// for a field the client may be resending whole from a previous GET is hostile for no reason — and
// a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationAdministrationErrorValidator = [
    ...dataFieldValidators
];
