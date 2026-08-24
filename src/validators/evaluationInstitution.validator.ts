import { body, param, query } from 'express-validator';

// The :id of the four operations entered by the row itself. ESAVI-EVALINST-005B and 005C reuse it,
// as every entity of the repository does: activating and purging address an evaluationInstitutionId
// like the 003 and the 004 do
export const evaluationInstitutionIdValidator = [
    param('id').notEmpty().withMessage('Evaluation Institution ID is required')
        .isUUID().withMessage('Evaluation Institution ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-EVALINST-002A and 002B. It is the
// investigationId — which names the clinical evaluation, not the investigation — so it carries its
// own message
export const evaluationInstitutionInvestigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the two listings return every institution of their clinical
// evaluation, and no filter by healthFacilityId, type or text is in scope
export const evaluationInstitutionListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// sortOrder is declared in no validator of this file. It is assigned by
// TRG_evaluationInstitution_setSortOrder and ignored in silence — answering 400 for a field a client
// may be resending whole from a GET is hostile, and the type does not carry it anyway.
//
// The maximum lengths do not all match the DDL, and that is deliberate. institutionName is capped at
// 250 because it is stored in clear and the column is varchar(250). personName and personContact are
// capped at 120 because they are *encrypted*: what has to fit in varchar(250) is the esaviCrypt
// ciphertext, which is longer than its plain text. A cap of 250 over the plain text would let through
// values Postgres rejects, and the error would surface from the driver as a 500 instead of from the
// validator as a 400.
//
// The "healthFacilityId or institutionName, at least one" rule is NOT here: in the update it depends
// on the stored state and not only on the body, so it lives in the service and answers 400 with its
// own i18n key. Declaring it in both places would duplicate the rule and desynchronize it
export const createEvaluationInstitutionValidator = [
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    body('healthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Health Facility ID must be a valid UUID').trim(),
    body('institutionName').optional({ nullable: true }).isString()
        .withMessage('Institution Name must be a string')
        .isLength({ max: 250 }).withMessage('Institution Name must be at most 250 characters long'),
    body('personName').optional({ nullable: true }).isString()
        .withMessage('Person Name must be a string')
        .isLength({ max: 120 }).withMessage('Person Name must be at most 120 characters long'),
    body('personContact').optional({ nullable: true }).isString()
        .withMessage('Person Contact must be a string')
        .isLength({ max: 120 }).withMessage('Person Contact must be at most 120 characters long'),
    body('evaluationInstitutionTypeItemId').optional({ nullable: true })
        .isUUID().withMessage('Evaluation Institution Type Item ID must be a valid UUID').trim(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// investigationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason. The same goes for sortOrder.
//
// The five data fields are nullable here, all of them: emptying any single one is legitimate, and
// what stops a row from being left unidentified is the service rule over the resulting state, not a
// per-field asymmetry like the one F27 and F33 chose for their name columns
export const updateEvaluationInstitutionValidator = [
    body('healthFacilityId').optional({ nullable: true })
        .isUUID().withMessage('Health Facility ID must be a valid UUID').trim(),
    body('institutionName').optional({ nullable: true }).isString()
        .withMessage('Institution Name must be a string')
        .isLength({ max: 250 }).withMessage('Institution Name must be at most 250 characters long'),
    body('personName').optional({ nullable: true }).isString()
        .withMessage('Person Name must be a string')
        .isLength({ max: 120 }).withMessage('Person Name must be at most 120 characters long'),
    body('personContact').optional({ nullable: true }).isString()
        .withMessage('Person Contact must be a string')
        .isLength({ max: 120 }).withMessage('Person Contact must be at most 120 characters long'),
    body('evaluationInstitutionTypeItemId').optional({ nullable: true })
        .isUUID().withMessage('Evaluation Institution Type Item ID must be a valid UUID').trim(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
