import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

// The :id of the six operations entered by the row itself. ESAVI-INVPREG-005B and 005C reuse it,
// as every entity of the repository does: activating and purging address a pregnancyConditionId
// like the 003 and the 004 do
export const investigationPregnancyConditionIdValidator = [
    param('id').notEmpty().withMessage('Pregnancy Condition ID is required')
        .isUUID().withMessage('Pregnancy Condition ID must be a valid UUID')
        .trim()
];

// The param of the two listings by foreign key, ESAVI-INVPREG-002A and 002B. It is the
// investigationId — which names the medical history, not the investigation — so it carries its own
// message
export const investigationPregnancyConditionInvestigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the two listings return every condition of their medical history,
// and no filter by diagnosticTermId or text is in scope
export const investigationPregnancyConditionListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// Three fields are declared in no validator of this file. sortOrder is assigned by
// TRG_investigationPregnancyCondition_setSortOrder and ignored in silence — answering 400 for a
// field a client may be resending whole from a GET is hostile, and the type does not carry it
// anyway. diagnosticTermId is never chosen by the client: it is what the resolution returns, and
// admitting it would open a second door to point at a term without going through conditionCode.
// And conditionRaw is derived, computed by the service against the master's name.
//
// conditionCode and source are the two accepted fields that are not columns of this table. They
// govern which branch of the resolution against the clinical master is taken and are discarded
// afterwards: the code lives in diagnosticTerm.
//
// The maximum lengths are the ones of the DDL — 500 for the name, which is what conditionRaw holds,
// and 100 for the code, which is what diagnosticTerm.code holds — so an overlong text is a readable
// 400 and not a Postgres 22001
export const createInvestigationPregnancyConditionValidator = [
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    body('conditionName').trim().notEmpty().withMessage('Condition Name is required')
        .isLength({ max: 500 }).withMessage('Condition Name must be at most 500 characters long'),
    body('conditionCode').optional({ nullable: true }).isString()
        .withMessage('Condition Code must be a string')
        .isLength({ max: 100 }).withMessage('Condition Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// investigationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason.
//
// conditionName is optional but *not nullable*, the asymmetry SPEC F27 chose for complicationName:
// a condition with no name informs of nothing, and the 001 demands it, so an explicit null would
// leave rows in the database the create would have rejected. Correcting a wrong name is done by
// sending the right one, not by erasing it. Since optional() only skips undefined, an explicit null
// falls through to notEmpty and answers 400. notes is nullable, as usual
export const updateInvestigationPregnancyConditionValidator = [
    body('conditionName').optional().trim().notEmpty().withMessage('Condition Name cannot be empty')
        .isLength({ max: 500 }).withMessage('Condition Name must be at most 500 characters long'),
    body('conditionCode').optional({ nullable: true }).isString()
        .withMessage('Condition Code must be a string')
        .isLength({ max: 100 }).withMessage('Condition Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
