import { body, param, query } from 'express-validator';

export const catalogTypeIdValidator = [
    param('id').exists().withMessage('Catalog Type ID is required')
        .isUUID().withMessage('Catalog Type ID must be a valid UUID')
        .trim()
];

export const catalogTypeListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('name').optional().trim()
        .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
        .isLength({ max: 200 }).withMessage('Name must be at most 200 characters long'),
    query('code').optional().trim()
        .isLength({ min: 2 }).withMessage('Code must be at least 2 characters long')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long')
];

// code is optional: absent, it is minted from the name. A code — or a name — that produces no usable
// identifier is a 400 of the service and not of this validator, which cannot see the rule
export const createCatalogTypeValidator = [
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 200 }).withMessage('Name must be at most 200 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer')
];

export const updateCatalogTypeValidator = [
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 200 }).withMessage('Name must be at most 200 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean value')
];