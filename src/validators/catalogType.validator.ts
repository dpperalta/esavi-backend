import { body, param, query } from 'express-validator';

export const catalogTypeIdValidator = [
    param('id').exists().withMessage('Catalog Type ID is required')
        .isUUID().withMessage('Catalog Type ID must be a valid UUID')
        .trim()
];

export const createCatalogTypeValidator = [
    body('code').trim().notEmpty().withMessage('Code is required').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 200 }).withMessage('Name must be at most 200 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer')
];

export const updateCatalogTypeValidator = [
    ...catalogTypeIdValidator,
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 200 }).withMessage('Name must be at most 200 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean value')
];