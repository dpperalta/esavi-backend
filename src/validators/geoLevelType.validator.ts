import { body, param } from 'express-validator';

export const createGeoLevelTypeValidator = [
    body('code').trim().notEmpty().withMessage('Code is required').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 150 }).withMessage('Name must be at most 150 characters long'),
    body('sortOrder').isInt({ min: 1 }).withMessage('Sort order must be a non-negative integer'),
];

export const updateGeoLevelTypeValidator = [
    param('id').isUUID().withMessage('Invalid GeoLevelType ID'),
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 150 }).withMessage('Name must be at most 150 characters long'),
    body('sortOrder').optional().isInt({ min: 1 }).withMessage('Sort order must be a non-negative integer'),
];