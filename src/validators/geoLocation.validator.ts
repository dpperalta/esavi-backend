import { body, param, query } from 'express-validator';

export const geoLocationIdValidator = [
    param('id').isUUID().withMessage('Invalid GeoLocation ID'),
];

export const geoLocationListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('name').optional().trim().isLength({ max: 200 })
        .withMessage('Name must be at most 200 characters long'),
    query('code').optional().trim().isLength({ max: 100 })
        .withMessage('Code must be at most 100 characters long'),
];

export const createGeoLocationValidator = [
    body('geoLevelTypeId').notEmpty().withMessage('Geographic level is required').isString().withMessage('Geographic level must be a string').isUUID().withMessage('Invalid Geographic Level Type'),
    body('parentGeoLocationId').optional().isUUID().withMessage('Invalid Parent GeoLocation ID'),
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 150 }).withMessage('Name must be at most 150 characters long'),
    body('externalCode').trim().notEmpty().withMessage('Code is required').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be a number between -90 and 90'),
    body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be a number between -180 and 180'),
    body('shortName').optional({ nullable: true }).trim().isLength({ max: 100 }).withMessage('Short name must be at most 50 characters long'),
    body('isoCode').optional({ nullable: true }).trim().isLength({ max: 10 }).withMessage('ISO code must be at most 10 characters long'),
    body('level').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Level must be a positive integer'),
];

export const updateGeoLocationValidator = [
    body('geoLevelTypeId').optional().notEmpty().withMessage('Geographic level is required').isString().withMessage('Geographic level must be a string').isUUID().withMessage('Invalid Geographic Level Type'),
    body('parentGeoLocationId').optional().isUUID().withMessage('Invalid Parent GeoLocation ID'),
    body('name').optional().trim().notEmpty().withMessage('Name is required').isLength({ max: 150 }).withMessage('Name must be at most 150 characters long'),
    body('externalCode').optional().trim().notEmpty().withMessage('Code is required').isLength({ max: 100 }).withMessage('Code must be at most 100 characters long'),
    body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be a number between -90 and 90'),
    body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be a number between -180 and 180'),
    body('shortName').optional({ nullable: true }).trim().isLength({ max: 100 }).withMessage('Short name must be at most 50 characters long'),
    body('isoCode').optional({ nullable: true }).trim().isLength({ max: 10 }).withMessage('ISO code must be at most 10 characters long'),
    body('level').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Level must be a positive integer'),
];

// ESAVI-GEOLOC-007 — the single query parameter of the template. Optional and boolean: without it
// sheets 1 and 2 come out with their header alone
export const generateGeoTemplateValidator = [
    query('includeExisting').optional().isBoolean().withMessage('Include existing must be a boolean')
];

// ESAVI-GEOLOC-006 — the single text field of the multipart body. The file itself is not validated
// here: multer takes it and uploadSingleFile turns its size and type problems into a 413 or a 400
export const importGeoDataValidator = [
    body('dryRun').optional().isBoolean().withMessage('Dry Run must be a boolean')
];
