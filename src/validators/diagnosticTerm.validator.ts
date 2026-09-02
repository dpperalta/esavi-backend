import { body, param, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

// The two encodings MedDRA files circulate in. Recent releases ship UTF-8, but latin-1 copies are
// still around and the symptom — 90 000 broken accents already written — shows up too late
const IMPORT_ENCODINGS = ['utf8', 'latin1'] as const;

export const diagnosticTermIdValidator = [
    param('id').notEmpty().withMessage('Diagnostic Term ID is required')
        .isUUID().withMessage('Diagnostic Term ID must be a valid UUID')
        .trim()
];

// Query validator shared by both listings. The two character minimum on search is what keeps the
// unindexed Op.iLike from scanning the whole catalog on a single letter; reviewStatus is declared
// here but only read by the admin listing
export const diagnosticTermListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('search').optional().trim()
        .isLength({ min: 2 }).withMessage('Search must be at least 2 characters long')
        .isLength({ max: 500 }).withMessage('Search must be at most 500 characters long'),
    query('name').optional().trim()
        .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
        .isLength({ max: 500 }).withMessage('Name must be at most 500 characters long'),
    query('code').optional().trim()
        .isLength({ min: 2 }).withMessage('Code must be at least 2 characters long')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    query('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${TERM_SOURCES.join(', ')}`),
    query('termGroup').optional().trim().notEmpty().withMessage('Term Group cannot be empty')
        .isLength({ max: 250 }).withMessage('Term Group must be at most 250 characters long'),
    query('reviewStatus').optional().trim().notEmpty().withMessage('Review Status cannot be empty')
        .isLength({ max: 50 }).withMessage('Review Status must be at most 50 characters long')
];

// code is required here even though esaviapp.sql:548 admits null. With every row coded, the
// UQ_diagnosticTerm_source_code constraint protects the whole table instead of leaving uncoded
// rows outside it. reviewStatus is not accepted on create: an administrative entry carries no
// markers, and metadata is written as {} by the service
export const createDiagnosticTermValidator = [
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${TERM_SOURCES.join(', ')}`),
    body('code').trim().notEmpty().withMessage('Code is required')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required')
        .isLength({ max: 500 }).withMessage('Name must be at most 500 characters long'),
    body('termGroup').optional().trim()
        .isLength({ max: 250 }).withMessage('Term Group must be at most 250 characters long'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];

// Bulk import (ESAVI-DIAGTERM-007). Every field is optional and every one of them travels as a
// text field of the multipart body, so nothing here is typed by the client: dryRun is validated
// against the two literal strings a form sends, and the service reads the boolean out of that.
// code and name are deliberately absent — the data comes from the file, never from the body
export const importDiagnosticTermsValidator = [
    body('source').optional().isIn(TERM_SOURCES)
        .withMessage(`Source must be one of: ${TERM_SOURCES.join(', ')}`),
    body('termGroup').optional().trim().notEmpty().withMessage('Term Group cannot be empty')
        .isLength({ max: 250 }).withMessage('Term Group must be at most 250 characters long'),
    body('dictionaryVersion').optional().trim().notEmpty().withMessage('Dictionary Version cannot be empty')
        .isLength({ max: 50 }).withMessage('Dictionary Version must be at most 50 characters long'),
    body('encoding').optional().isIn(IMPORT_ENCODINGS)
        .withMessage(`Encoding must be one of: ${IMPORT_ENCODINGS.join(', ')}`),
    body('dryRun').optional().isBoolean().withMessage('Dry Run must be a boolean')
];

// source is deliberately absent: it is immutable and the service ignores it in silence, so
// declaring a rule for it would turn a field nobody meant to change into a 400. termGroup admits
// null on purpose — that is how the column is emptied, and it is a different intent from omitting
// the key. reviewStatus arrives flat and the service merges it over the stored metadata
export const updateDiagnosticTermValidator = [
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty')
        .isLength({ max: 500 }).withMessage('Name must be at most 500 characters long'),
    body('termGroup').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Term Group must be at most 250 characters long'),
    body('reviewStatus').optional().trim().notEmpty().withMessage('Review Status cannot be empty')
        .isLength({ max: 50 }).withMessage('Review Status must be at most 50 characters long')
];
