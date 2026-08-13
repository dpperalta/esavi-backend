import { body } from 'express-validator';
import { TERM_SOURCES } from '../constants/enums.constants';

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
