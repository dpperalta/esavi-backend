import { body, param, query } from 'express-validator';

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVSRC-005C
export const investigationSourceIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVSRC-006, which walks case -> investigation -> source
export const investigationSourceCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Unlike its two elder sisters, this entity does have a dual listing: the visibility is inherited
// from investigation.isActive, so 002A and 002B return different sets. The two filters are
// accumulative with AND and by equality — investigationId over the primary key itself, caseId over
// the where of the investigation include, which travels in the query anyway
export const investigationSourceListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The eight information sources are plain booleans and not answerOption: the DDL declares them
// boolean (esaviapp.sql:958-965). They stay optional and nullable, which is what keeps them
// tri-state — null is "the form did not collect it" and false is a deliberate no, and a client must
// be able to send either one. Neither text carries a maximum length: both columns are text in the
// DDL, with no varchar(n) to replicate.
//
// The other source rule is not checked here: it is evaluated over the resulting state — on update
// the stored row merged with the body — which the validator does not see. It lives in the service
// and answers 400 too. That is also why the description is not required to be non-empty here: a
// blank description under a resulting true is the service's OTHER_DESCRIPTION_REQUIRED, not a
// shape error
export const createInvestigationSourceValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid()
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    body('history').optional({ nullable: true })
        .isBoolean().withMessage('History must be a boolean'),
    body('interviewVaccinatedPerson').optional({ nullable: true })
        .isBoolean().withMessage('Interview Vaccinated Person must be a boolean'),
    body('interviewHealthWorker').optional({ nullable: true })
        .isBoolean().withMessage('Interview Health Worker must be a boolean'),
    body('vaccinationRecord').optional({ nullable: true })
        .isBoolean().withMessage('Vaccination Record must be a boolean'),
    body('autopsyRecord').optional({ nullable: true })
        .isBoolean().withMessage('Autopsy Record must be a boolean'),
    body('verbalAutopsyRecord').optional({ nullable: true })
        .isBoolean().withMessage('Verbal Autopsy Record must be a boolean'),
    body('investigationReport').optional({ nullable: true })
        .isBoolean().withMessage('Investigation Report must be a boolean'),
    body('other').optional({ nullable: true })
        .isBoolean().withMessage('Other must be a boolean'),
    body('otherDescription').optional({ nullable: true }).isString()
        .withMessage('Other Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason
export const updateInvestigationSourceValidator = [
    body('history').optional({ nullable: true })
        .isBoolean().withMessage('History must be a boolean'),
    body('interviewVaccinatedPerson').optional({ nullable: true })
        .isBoolean().withMessage('Interview Vaccinated Person must be a boolean'),
    body('interviewHealthWorker').optional({ nullable: true })
        .isBoolean().withMessage('Interview Health Worker must be a boolean'),
    body('vaccinationRecord').optional({ nullable: true })
        .isBoolean().withMessage('Vaccination Record must be a boolean'),
    body('autopsyRecord').optional({ nullable: true })
        .isBoolean().withMessage('Autopsy Record must be a boolean'),
    body('verbalAutopsyRecord').optional({ nullable: true })
        .isBoolean().withMessage('Verbal Autopsy Record must be a boolean'),
    body('investigationReport').optional({ nullable: true })
        .isBoolean().withMessage('Investigation Report must be a boolean'),
    body('other').optional({ nullable: true })
        .isBoolean().withMessage('Other must be a boolean'),
    body('otherDescription').optional({ nullable: true }).isString()
        .withMessage('Other Description must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
