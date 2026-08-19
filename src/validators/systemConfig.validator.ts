import { body, param, query } from 'express-validator';
import { SYSTEM_CONFIG_VALUE_TYPES } from '../helpers';

export const systemConfigIdValidator = [
    param('id').notEmpty().withMessage('System config ID is required')
        .isUUID().withMessage('System config ID must be a valid UUID')
        .trim()
];

// The 006 enters by the name of the parameter, not by its UUID. code arrives through the path and
// scope through the query, optional with a GLOBAL default; the service normalizes both with
// toConstantCase before searching, so nothing here restricts their shape beyond the widths of the DDL
export const systemConfigCodeValidator = [
    param('code').trim().notEmpty().withMessage('System config code is required')
        .isLength({ max: 150 }).withMessage('System config code must be at most 150 characters long'),
    query('scope').optional().trim().notEmpty().withMessage('Scope cannot be empty')
        .isLength({ max: 100 }).withMessage('Scope must be at most 100 characters long')
];

// Query validator shared by both listings — they take exactly the same three filters. The two
// character minimum on search is what keeps the Op.iLike from scanning the whole table on a single
// letter; the only index of the table is the partial one over isActive, so that minimum and the
// ceiling of 100 rows are what bound the cost.
// valueType is restricted here and not in the service: unlike the cross validation against value,
// this one needs nothing from the database, so it belongs where every other 400 of input comes from.
// scope declares no minimum — it compares for equality, not by fragment, and the service normalizes
// it with toConstantCase before asking
export const systemConfigListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('scope').optional().trim().notEmpty().withMessage('Scope cannot be empty')
        .isLength({ max: 100 }).withMessage('Scope must be at most 100 characters long'),
    query('valueType').optional().isIn(SYSTEM_CONFIG_VALUE_TYPES)
        .withMessage(`Value type must be one of: ${ SYSTEM_CONFIG_VALUE_TYPES.join(', ') }`),
    query('search').optional().trim()
        .isLength({ min: 2 }).withMessage('Search must be at least 2 characters long')
        .isLength({ max: 500 }).withMessage('Search must be at most 500 characters long')
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
