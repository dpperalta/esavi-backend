import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

// diagnosticDate is a calendar date, so it is compared as a plain YYYY-MM-DD string: building a
// Date would drag the server time zone into the comparison and could reject today or admit
// tomorrow depending on the offset. Same criterion as esaviCase, classification, notification,
// patient, investigation and investigationAutopsy, each of which keeps its own copy
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

// Pagination, shared by the three listings — 002A, 002B and 006. It is spread into the two param
// validators below instead of being exported as a list validator of its own, because none of the
// three listings admits a single filter: every one of them returns the whole diagnosis list of its
// parent, ordered by sortOrder. In particular there is no filter by diagnosticTypeItemId
const paginationRules = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// :id is the diagnosticId. The param of 003, 004, 005A, 005B and 005C — activating and purging
// address the row itself, as every entity of the repository does
export const investigationDiagnosticIdValidator = [
    param('id').notEmpty().withMessage('Investigation Diagnostic ID is required')
        .isUUID().withMessage('Investigation Diagnostic ID must be a valid UUID')
        .trim()
];

// The param of the two listings by parent, ESAVI-INVDIAG-002A and 002B. It is the investigationId,
// not a diagnosticId, so it carries its own message
export const investigationDiagnosticInvestigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim(),
    ...paginationRules
];

// The param of ESAVI-INVDIAG-006, which walks case -> investigation -> diagnostics
export const investigationDiagnosticCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim(),
    ...paginationRules
];

// Three columns of the table are declared in no validator of this file. sortOrder is assigned by
// TRG_investigationDiagnostic_setSortOrder and ignored in silence — answering 400 for a field a
// client may be resending whole from a GET is hostile, and the type does not carry it anyway.
// diagnosticTermId is never chosen by the client: it is what the resolution returns, and admitting
// it would open a second door to point at a term without going through diagnosticCode. And
// diagnosticRaw is derived, computed by the service against the master's name.
//
// diagnosticCode and source are the two accepted fields that are not columns of this table. They
// govern which branch of the resolution against the clinical master is taken and are discarded
// afterwards: the code lives in diagnosticTerm.
//
// The maximum lengths are the ones of the DDL — 500 for the name, which is what diagnosticRaw
// holds, and 100 for the code, which is what diagnosticTerm.code holds — so an overlong text is a
// readable 400 and not a Postgres 22001.
//
// diagnosticDate is checked for shape and for one semantic rule, "not in the future". That rule
// lives here and only here: a CHECK over current_date is not immutable and Postgres rejects it, so
// the database cannot back it. Nothing else is checked about it — it is deliberately not crossed
// against investigation.investigationStartDate, investigation.hospitalizationDate or
// esaviCase.eventDate
export const createInvestigationDiagnosticValidator = [
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    body('diagnosticName').trim().notEmpty().withMessage('Diagnostic Name is required')
        .isLength({ max: 500 }).withMessage('Diagnostic Name must be at most 500 characters long'),
    body('diagnosticCode').optional({ nullable: true }).isString()
        .withMessage('Diagnostic Code must be a string')
        .isLength({ max: 100 }).withMessage('Diagnostic Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('diagnosticDate').optional({ nullable: true }).isISO8601()
        .withMessage('Diagnostic Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Diagnostic Date cannot be in the future'),
    body('diagnosticTypeItemId').optional({ nullable: true })
        .isUUID().withMessage('Diagnostic Type Item ID must be a valid UUID').trim(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];

// investigationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason.
//
// diagnosticName is optional but *not nullable*, the asymmetry SPEC F27 chose for complicationName
// and F33 for conditionName: a diagnosis with no name informs of nothing, and the 001 demands it,
// so an explicit null would leave rows in the database the create would have rejected. Correcting a
// wrong name is done by sending the right one, not by erasing it. Since optional() only skips
// undefined, an explicit null falls through to notEmpty and answers 400.
//
// diagnosticDate, diagnosticTypeItemId and notes are nullable: an explicit null erases the value
// and counts as a difference for buildDifferentialUpdate
export const updateInvestigationDiagnosticValidator = [
    body('diagnosticName').optional().trim().notEmpty().withMessage('Diagnostic Name cannot be empty')
        .isLength({ max: 500 }).withMessage('Diagnostic Name must be at most 500 characters long'),
    body('diagnosticCode').optional({ nullable: true }).isString()
        .withMessage('Diagnostic Code must be a string')
        .isLength({ max: 100 }).withMessage('Diagnostic Code must be at most 100 characters long'),
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${ TERM_SOURCES.join(', ') }`),
    body('diagnosticDate').optional({ nullable: true }).isISO8601()
        .withMessage('Diagnostic Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Diagnostic Date cannot be in the future'),
    body('diagnosticTypeItemId').optional({ nullable: true })
        .isUUID().withMessage('Diagnostic Type Item ID must be a valid UUID').trim(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean').toBoolean()
];
