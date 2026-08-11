import { body, param, query } from 'express-validator';

export const notifierIdValidator = [
    param('id').notEmpty().withMessage('Notifier ID is required')
        .isUUID().withMessage('Notifier ID must be a valid UUID')
        .trim()
];

// The three filters of 002A and 002B, accumulated with AND. There is no filter by name,
// email or address: those columns hold the ciphertext and only exact equality would work
export const notifierListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('professionItemId').optional()
        .isUUID().withMessage('Profession Item ID must be a valid UUID').trim(),
    query('geoLocationId').optional()
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The lengths are checked against the plain text, before the service encrypts: the user
// writes plain text and the 400 must talk about what was written, not about the ciphertext
export const createNotifierValidator = [
    body('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    body('firstName').trim().notEmpty().withMessage('First Name is required')
        .isLength({ min: 2, max: 150 }).withMessage('First Name must be between 2 and 150 characters long'),
    // Required by the application although the DDL allows it null: a notifier with only a
    // given name identifies nobody
    body('lastName').trim().notEmpty().withMessage('Last Name is required')
        .isLength({ min: 2, max: 150 }).withMessage('Last Name must be between 2 and 150 characters long'),
    body('professionItemId').optional({ nullable: true })
        .isUUID().withMessage('Profession Item ID must be a valid UUID').trim(),
    body('geoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    body('room').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Room must be at most 50 characters long'),
    body('address').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Address must be at most 250 characters long'),
    body('phoneNumber').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone Number must be at most 50 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address'),
    body('details').optional({ nullable: true }).isString()
        .withMessage('Details must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];

// `caseId` is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason
export const updateNotifierValidator = [
    body('firstName').optional().trim().notEmpty().withMessage('First Name cannot be empty')
        .isLength({ min: 2, max: 150 }).withMessage('First Name must be between 2 and 150 characters long'),
    body('lastName').optional().trim().notEmpty().withMessage('Last Name cannot be empty')
        .isLength({ min: 2, max: 150 }).withMessage('Last Name must be between 2 and 150 characters long'),
    body('professionItemId').optional({ nullable: true })
        .isUUID().withMessage('Profession Item ID must be a valid UUID').trim(),
    body('geoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    body('room').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Room must be at most 50 characters long'),
    body('address').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Address must be at most 250 characters long'),
    body('phoneNumber').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone Number must be at most 50 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address'),
    body('details').optional({ nullable: true }).isString()
        .withMessage('Details must be a string'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];
