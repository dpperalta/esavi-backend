import { body, param, query } from 'express-validator';

// A birth date is a calendar date, so it is compared as a plain YYYY-MM-DD string:
// building a Date would drag the server time zone into the comparison and could
// reject today or admit tomorrow depending on the offset
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const isNotFutureDate = (value: string): boolean => String(value).slice(0, 10) <= todayIsoDate();

export const patientIdValidator = [
    param('id').notEmpty().withMessage('Patient ID is required')
        .isUUID().withMessage('Patient ID must be a valid UUID')
        .trim()
];

export const patientListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

export const patientIdentifierValidator = [
    param('identifier').trim().notEmpty().withMessage('Identifier is required')
        .isLength({ max: 100 }).withMessage('Identifier must be at most 100 characters long')
];

export const createPatientValidator = [
    body('firstName').trim().notEmpty().withMessage('First Name is required')
        .isLength({ max: 150 }).withMessage('First Name must be at most 150 characters long'),
    body('lastName').trim().notEmpty().withMessage('Last Name is required')
        .isLength({ max: 150 }).withMessage('Last Name must be at most 150 characters long'),
    body('documentNumber').trim().notEmpty().withMessage('Document Number is required')
        .isLength({ max: 100 }).withMessage('Document Number must be at most 100 characters long'),
    body('middleName').optional({ nullable: true }).trim()
        .isLength({ max: 150 }).withMessage('Middle Name must be at most 150 characters long'),
    body('secondLastName').optional({ nullable: true }).trim()
        .isLength({ max: 150 }).withMessage('Second Last Name must be at most 150 characters long'),
    body('birthDate').optional({ nullable: true }).isISO8601()
        .withMessage('Birth Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Birth Date cannot be in the future'),
    body('passportNumber').optional({ nullable: true }).trim()
        .isLength({ max: 100 }).withMessage('Passport Number must be at most 100 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address')
        .isLength({ max: 255 }).withMessage('Email must be at most 255 characters long'),
    body('phoneNumber').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone Number must be at most 50 characters long'),
    body('sexItemId').optional({ nullable: true })
        .isUUID().withMessage('Sex Item ID must be a valid UUID').trim(),
    body('residenceGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Residence Geo Location ID must be a valid UUID').trim()
];

export const updatePatientValidator = [
    body('firstName').optional().trim().notEmpty().withMessage('First Name cannot be empty')
        .isLength({ max: 150 }).withMessage('First Name must be at most 150 characters long'),
    body('lastName').optional().trim().notEmpty().withMessage('Last Name cannot be empty')
        .isLength({ max: 150 }).withMessage('Last Name must be at most 150 characters long'),
    body('documentNumber').optional().trim().notEmpty().withMessage('Document Number cannot be empty')
        .isLength({ max: 100 }).withMessage('Document Number must be at most 100 characters long'),
    body('middleName').optional({ nullable: true }).trim()
        .isLength({ max: 150 }).withMessage('Middle Name must be at most 150 characters long'),
    body('secondLastName').optional({ nullable: true }).trim()
        .isLength({ max: 150 }).withMessage('Second Last Name must be at most 150 characters long'),
    body('birthDate').optional({ nullable: true }).isISO8601()
        .withMessage('Birth Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Birth Date cannot be in the future'),
    body('passportNumber').optional({ nullable: true }).trim()
        .isLength({ max: 100 }).withMessage('Passport Number must be at most 100 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address')
        .isLength({ max: 255 }).withMessage('Email must be at most 255 characters long'),
    body('phoneNumber').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone Number must be at most 50 characters long'),
    body('sexItemId').optional({ nullable: true })
        .isUUID().withMessage('Sex Item ID must be a valid UUID').trim(),
    body('residenceGeoLocationId').optional({ nullable: true })
        .isUUID().withMessage('Residence Geo Location ID must be a valid UUID').trim()
];
