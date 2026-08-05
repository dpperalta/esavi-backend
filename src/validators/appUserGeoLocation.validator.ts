import { body, param, query } from 'express-validator';

export const appUserGeoLocationIdValidator = [
    param('id').notEmpty().withMessage('User Geo Location ID is required')
        .isUUID().withMessage('User Geo Location ID must be a valid UUID')
        .trim()
];

export const userIdParamValidator = [
    param('userId').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID')
        .trim()
];

export const appUserGeoLocationListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('current').optional().isBoolean()
        .withMessage('Current must be a boolean value')
];

export const createAppUserGeoLocationValidator = [
    body('userId').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID').trim(),
    body('geoLocationId').notEmpty().withMessage('Geo Location ID is required')
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    body('validFrom').optional().isISO8601()
        .withMessage('Valid From must be a valid ISO 8601 date'),
    body('validTo').optional({ nullable: true }).isISO8601()
        .withMessage('Valid To must be a valid ISO 8601 date')
];

// Reassigning is ESAVI-USERGEO-006, so the update rejects the two foreign keys
// instead of silently ignoring them.
export const updateAppUserGeoLocationValidator = [
    body('userId').not().exists()
        .withMessage('User ID cannot be updated. Use the reassign endpoint instead.'),
    body('geoLocationId').not().exists()
        .withMessage('Geo Location ID cannot be updated. Use the reassign endpoint instead.'),
    body('validFrom').optional().isISO8601()
        .withMessage('Valid From must be a valid ISO 8601 date'),
    body('validTo').optional({ nullable: true }).isISO8601()
        .withMessage('Valid To must be a valid ISO 8601 date')
];

export const bulkAssignValidator = [
    body('userId').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID').trim(),
    body('geoLocationIds').isArray({ min: 1 })
        .withMessage('Geo Location IDs must be a non-empty array'),
    body('geoLocationIds.*').isUUID()
        .withMessage('Every Geo Location ID must be a valid UUID'),
    // A repeated ID would make the all-or-nothing transaction collide with itself
    body('geoLocationIds').custom((ids: string[]) => !Array.isArray(ids) || new Set(ids).size === ids.length)
        .withMessage('Geo Location IDs must not contain duplicates'),
    body('validFrom').optional().isISO8601()
        .withMessage('Valid From must be a valid ISO 8601 date'),
    body('validTo').optional({ nullable: true }).isISO8601()
        .withMessage('Valid To must be a valid ISO 8601 date')
];

export const reassignValidator = [
    body('geoLocationId').notEmpty().withMessage('Geo Location ID is required')
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim()
];
