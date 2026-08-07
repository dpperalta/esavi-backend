import { body, param, query } from 'express-validator';

export const appUserRoleIdValidator = [
    param('id').notEmpty().withMessage('User Role ID is required')
        .isUUID().withMessage('User Role ID must be a valid UUID')
        .trim()
];

export const roleIdParamValidator = [
    param('roleId').notEmpty().withMessage('Role ID is required')
        .isUUID().withMessage('Role ID must be a valid UUID')
        .trim()
];

// userIdParamValidator is not declared here on purpose: appUserGeoLocation.validator.ts
// already exports an identical one through the barrel.

export const appUserRoleListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// validFrom and validTo are out of the functional scope: isActive governs the state.
// They are rejected instead of ignored so the client knows the field has no effect.
export const createAppUserRoleValidator = [
    body('userId').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID').trim(),
    body('roleId').notEmpty().withMessage('Role ID is required')
        .isUUID().withMessage('Role ID must be a valid UUID').trim(),
    body('validFrom').not().exists()
        .withMessage('Valid From is not accepted. Role assignment validity is governed by activation.'),
    body('validTo').not().exists()
        .withMessage('Valid To is not accepted. Role assignment validity is governed by activation.')
];

export const bulkAssignRolesValidator = [
    body('userId').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID').trim(),
    body('roleIds').isArray({ min: 1 })
        .withMessage('Role IDs must be a non-empty array'),
    body('roleIds.*').isUUID()
        .withMessage('Every Role ID must be a valid UUID'),
    // A repeated ID would make the all-or-nothing transaction collide with itself
    body('roleIds').custom((ids: string[]) => !Array.isArray(ids) || new Set(ids).size === ids.length)
        .withMessage('Role IDs must not contain duplicates'),
    body('validFrom').not().exists()
        .withMessage('Valid From is not accepted. Role assignment validity is governed by activation.'),
    body('validTo').not().exists()
        .withMessage('Valid To is not accepted. Role assignment validity is governed by activation.')
];
