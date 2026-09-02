import { body, param, query } from 'express-validator';

export const healthFacilityIdValidator = [
    param('id').notEmpty().withMessage('Health Facility ID is required')
        .isUUID().withMessage('Health Facility ID must be a valid UUID')
        .trim()
];

export const healthFacilityListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// ESAVI-HFAC-006 - Both text criteria are declared optional() one by one; 'at least one of name
// or code' cannot be expressed here and lives in the service. The max lengths follow the DDL:
// 250 for the three name columns and 200 for localCode. The min of 2 keeps a single character
// from scanning the whole national table to return a page of noise
export const searchHealthFacilityValidator = [
    query('name').optional().trim()
        .isLength({ min: 2 }).withMessage('Name must be at least 2 characters long')
        .isLength({ max: 250 }).withMessage('Name must be at most 250 characters long'),
    query('code').optional().trim()
        .isLength({ min: 2 }).withMessage('Code must be at least 2 characters long')
        .isLength({ max: 200 }).withMessage('Code must be at most 200 characters long'),
    query('geoLocationId').optional().isUUID().withMessage('Geo Location ID must be a valid UUID').trim()
];

export const createHealthFacilityValidator = [
    body('geoLocationId').notEmpty().withMessage('Geo Location ID is required')
        .isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    body('parentHealthFacilityId').optional().isUUID().withMessage('Parent Health Facility ID must be a valid UUID').trim(),
    body('facilityTypeItemId').optional().notEmpty().withMessage('Facility Type Item ID is required')
        .isUUID().withMessage('Facility Type Item ID must be a valid UUID').trim(),
    body('localCode').optional().trim().notEmpty().withMessage('Local Code cannot be empty')
        .isLength({ max: 200 }).withMessage('Local Code must be at most 200 characters long'),
    body('name').trim().notEmpty().withMessage('Name is required')
        .isLength({ max: 255 }).withMessage('Name must be at most 255 characters long'),
    body('officialName').optional().trim()
        .isLength({ max: 255 }).withMessage('Official Name must be at most 255 characters long'),
    body('shortName').optional().trim()
        .isLength({ max: 100 }).withMessage('Short Name must be at most 100 characters long'),
    body('address').optional().trim()
        .isLength({ max: 255 }).withMessage('Address must be at most 255 characters long'),
    body('latitude').optional().isDecimal({ decimal_digits: '0,7' }).withMessage('Latitude must be a decimal number with up to 7 decimal places'),
    body('longitude').optional().isDecimal({ decimal_digits: '0,7' }).withMessage('Longitude must be a decimal number with up to 7 decimal places'),
    body('phone').optional().trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('email').optional().trim()
        .isEmail().withMessage('Email must be a valid email address')
        .isLength({ max: 255 }).withMessage('Email must be at most 255 characters long')
];

export const updateHealthFacilityValidator = [
    body('geoLocationId').optional().isUUID().withMessage('Geo Location ID must be a valid UUID').trim(),
    body('parentHealthFacilityId').optional().isUUID().withMessage('Parent Health Facility ID must be a valid UUID').trim(),
    body('facilityTypeItemId').optional().notEmpty().withMessage('Facility Type Item ID is required')
        .isUUID().withMessage('Facility Type Item ID must be a valid UUID').trim(),
    body('localCode').optional().trim().notEmpty().withMessage('Local Code cannot be empty')
        .isLength({ max: 200 }).withMessage('Local Code must be at most 200 characters long'),
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty')
        .isLength({ max: 255 }).withMessage('Name must be at most 255 characters long'),
    body('officialName').optional().trim()
        .isLength({ max: 255 }).withMessage('Official Name must be at most 255 characters long'),
    body('shortName').optional().trim()
        .isLength({ max: 100 }).withMessage('Short Name must be at most 100 characters long'),
    body('address').optional().trim()
        .isLength({ max: 255 }).withMessage('Address must be at most 255 characters long'),
    body('latitude').optional().isDecimal({ decimal_digits: '0,7' }).withMessage('Latitude must be a decimal number with up to 7 decimal places'),
    body('longitude').optional().isDecimal({ decimal_digits: '0,7' }).withMessage('Longitude must be a decimal number with up to 7 decimal places'),
    body('phone').optional().trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('email').optional().trim()
        .isEmail().withMessage('Email must be a valid email address')
        .isLength({ max: 255 }).withMessage('Email must be at most 255 characters long')
];