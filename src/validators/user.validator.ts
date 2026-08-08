import { body, param, query } from 'express-validator';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// roleId accepts a single UUID or an array of UUIDs, matching CreateUserInput
const isUuidOrUuidArray = (value: unknown): boolean => {
    const ids = Array.isArray(value) ? value : [value];
    return ids.length > 0 && ids.every((id) => typeof id === 'string' && UUID_PATTERN.test(id.trim()));
};

export const userIdValidator = [
    param('id').notEmpty().withMessage('User ID is required')
        .isUUID().withMessage('User ID must be a valid UUID')
        .trim()
];

export const userListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// displayName is calculated from firstName and lastName; isActive, requiresPasswordChange
// and lastLoginAt are governed by the system. They are rejected instead of ignored so the
// client knows the field has no effect.
export const createUserValidator = [
    body('username').optional().trim().notEmpty().withMessage('Username cannot be empty')
        .isLength({ max: 250 }).withMessage('Username must be at most 250 characters long'),
    body('email').trim().notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format')
        .isLength({ max: 250 }).withMessage('Email must be at most 250 characters long'),
    body('password').trim().notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('firstName').trim().notEmpty().withMessage('First name is required')
        .isLength({ max: 150 }).withMessage('First name must be at most 150 characters long'),
    body('lastName').trim().notEmpty().withMessage('Last name is required')
        .isLength({ max: 150 }).withMessage('Last name must be at most 150 characters long'),
    body('phone').optional().trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('statusItemId').optional().isUUID().withMessage('Status Item ID must be a valid UUID').trim(),
    body('roleId').notEmpty().withMessage('Role ID is required')
        .custom(isUuidOrUuidArray)
        .withMessage('Role ID must be a valid UUID or an array of valid UUIDs'),
    body('displayName').not().exists()
        .withMessage('Display Name is not accepted. It is calculated from the first and last name.'),
    body('isActive').not().exists()
        .withMessage('Is Active is not accepted. Activation is governed by its own endpoints.'),
    body('requiresPasswordChange').not().exists()
        .withMessage('Requires Password Change is not accepted. It is governed by the system.'),
    body('lastLoginAt').not().exists()
        .withMessage('Last Login At is not accepted. It is written by the login operation.')
];

// password and roleId are out of this operation's scope: the first belongs to the password
// change operation, the second to the user role assignment endpoints.
export const updateUserValidator = [
    body('username').optional().trim().notEmpty().withMessage('Username cannot be empty')
        .isLength({ max: 250 }).withMessage('Username must be at most 250 characters long'),
    body('email').optional().trim().notEmpty().withMessage('Email cannot be empty')
        .isEmail().withMessage('Invalid email format')
        .isLength({ max: 250 }).withMessage('Email must be at most 250 characters long'),
    body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty')
        .isLength({ max: 150 }).withMessage('First name must be at most 150 characters long'),
    body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty')
        .isLength({ max: 150 }).withMessage('Last name must be at most 150 characters long'),
    body('phone').optional().trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('statusItemId').optional().isUUID().withMessage('Status Item ID must be a valid UUID').trim(),
    body('password').not().exists()
        .withMessage('Password is not accepted. Use the change password endpoint instead.'),
    body('roleId').not().exists()
        .withMessage('Role ID is not accepted. User roles are governed by their own endpoints.'),
    body('displayName').not().exists()
        .withMessage('Display Name is not accepted. It is calculated from the first and last name.'),
    body('isActive').not().exists()
        .withMessage('Is Active is not accepted. Activation is governed by its own endpoints.'),
    body('requiresPasswordChange').not().exists()
        .withMessage('Requires Password Change is not accepted. It is governed by the system.'),
    body('lastLoginAt').not().exists()
        .withMessage('Last Login At is not accepted. It is written by the login operation.'),
    body('externalProvider').not().exists()
        .withMessage('External Provider is not accepted. External authentication is not supported.'),
    body('externalSubject').not().exists()
        .withMessage('External Subject is not accepted. External authentication is not supported.')
];

// The operation always acts on the token holder: no user identifier is accepted.
export const changePasswordValidator = [
    body('currentPassword').trim().notEmpty().withMessage('Current password is required'),
    body('newPassword').trim().notEmpty().withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
    body('userId').not().exists()
        .withMessage('User ID is not accepted. The password change always applies to the authenticated user.'),
    body('id').not().exists()
        .withMessage('ID is not accepted. The password change always applies to the authenticated user.')
];
