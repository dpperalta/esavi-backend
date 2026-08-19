import { body, param } from 'express-validator';
import { SYSTEM_CONFIG_VALUE_TYPES } from '../helpers';

export const systemConfigIdValidator = [
    param('id').notEmpty().withMessage('System config ID is required')
        .isUUID().withMessage('System config ID must be a valid UUID')
        .trim()
];

// The eight data columns of §3.1, all writable on create. The isLength ceilings match the varchar
// widths of the DDL; description declares none because the column is text.
// value is required and validated only for presence here: its cross validation against valueType
// lives in the service, which is the declared exception to every 400 coming out of validateFields —
// the 004 needs the stored valueType when the body does not carry one, and a validator chain does not
// query the database. `exists()` and not `notEmpty()`: false, 0 and null are legitimate values that
// notEmpty would reject.
// valueType is restricted to the same five literals as CK_systemConfig_valueType, read from the
// helper so they are not spelled a third time.
// changeReason is optional here and required in the update when the body carries value: without it
// the history records who and when but never why, and demanding it always would block a correction
// of name over a formality
export const createSystemConfigValidator = [
    body('code').trim().notEmpty().withMessage('System config code is required')
        .isLength({ max: 150 }).withMessage('System config code must be at most 150 characters long'),
    body('name').trim().notEmpty().withMessage('System config name is required')
        .isLength({ max: 200 }).withMessage('System config name must be at most 200 characters long'),
    body('description').optional({ nullable: true }).trim(),
    body('value').exists().withMessage('System config value is required'),
    body('valueType').optional().isIn(SYSTEM_CONFIG_VALUE_TYPES)
        .withMessage(`Value type must be one of: ${ SYSTEM_CONFIG_VALUE_TYPES.join(', ') }`),
    body('scope').optional().trim().notEmpty().withMessage('System config scope cannot be empty')
        .isLength({ max: 100 }).withMessage('System config scope must be at most 100 characters long'),
    body('isEncrypted').optional().isBoolean().withMessage('Is Encrypted must be a boolean'),
    body('isEditable').optional().isBoolean().withMessage('Is Editable must be a boolean'),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean'),
    body('changeReason').optional({ nullable: true }).trim()
];
