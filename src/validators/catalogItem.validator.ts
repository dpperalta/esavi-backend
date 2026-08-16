import { body, param, query } from 'express-validator';

export const catalogItemIdValidator = [
    param('id').notEmpty().withMessage('Catalog Item ID is required')
        .isUUID().withMessage('Catalog Item ID must be a valid UUID')
        .trim()
];

export const catalogItemListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

export const createCatalogItemValidator = [
    body('catalogTypeId').notEmpty().withMessage('Catalog Type ID is required')
        .isUUID().withMessage('Catalog Type ID must be a valid UUID').trim(),
    body('code').trim().notEmpty().withMessage('Code is required')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    body('value').trim().notEmpty().withMessage('Value is required')
        .isLength({ max: 250 }).withMessage('Value must be at most 250 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object')
];

export const updateCatalogItemValidator = [
    body('catalogTypeId').optional().isUUID().withMessage('Catalog Type ID must be a valid UUID').trim(),
    body('code').optional().trim().notEmpty().withMessage('Code cannot be empty')
        .isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    body('value').optional().trim().notEmpty().withMessage('Value cannot be empty')
        .isLength({ max: 250 }).withMessage('Value must be at most 250 characters long'),
    body('description').optional().isString().withMessage('Description must be a string'),
    body('sortOrder').optional().isInt({ min: 0 }).withMessage('Sort Order must be a non-negative integer'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object'),
    body('isActive').optional().isBoolean().withMessage('isActive must be a boolean value')
];

// Body of ESAVI-CATITEM-006. It declares no data column: they all come from the file, which travels
// as a file field and is validated by multer and by the parser, not here. dryRun arrives as a text
// field of a multipart body, so isBoolean() reads the string 'true' the same way it would in a query
// string. There is no dictionaryVersion: this importer never writes metadata, so there would be
// nowhere to keep it
export const importCatalogItemsValidator = [
    body('dryRun').optional().isBoolean().withMessage('Dry Run must be a boolean')
];