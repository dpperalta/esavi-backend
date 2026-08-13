import { body, query } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

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
