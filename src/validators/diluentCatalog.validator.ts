import { body, param, query } from 'express-validator';

export const diluentCatalogIdValidator = [
    param('id').notEmpty().withMessage('Diluent ID is required')
        .isUUID().withMessage('Diluent ID must be a valid UUID')
        .trim()
];

// Query validator shared by both listings — they take exactly the same single filter. The two
// character minimum on search is what keeps the unindexed Op.iLike from scanning the whole catalog
// on a single letter; the table declares no index of its own, so that minimum and the ceiling of
// 100 rows are what bound the cost
export const diluentCatalogListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('search').optional().trim()
        .isLength({ min: 2 }).withMessage('Search must be at least 2 characters long')
        .isLength({ max: 500 }).withMessage('Search must be at most 500 characters long')
];

// code is required here even though esaviapp.sql:605 admits null: a diluent without a code cannot be
// crossed against anything, which is the only thing a master exists for. An API stricter than the
// schema is the safe direction, and it is the same move SPEC F15 and SPEC F18 made. Its uniqueness
// is global and the service checks it against the already normalized value.
// description and composition admit null explicitly, which is how a column is emptied and is a
// different intent from omitting the key. The two isLength ceilings match the varchar widths of the
// DDL; the text columns declare none because the columns declare none
export const createDiluentCatalogValidator = [
    body('code').trim().notEmpty().withMessage('Diluent code is required')
        .isLength({ max: 100 }).withMessage('Diluent code must be at most 100 characters long'),
    body('name').trim().notEmpty().withMessage('Diluent name is required')
        .isLength({ max: 250 }).withMessage('Diluent name must be at most 250 characters long'),
    body('description').optional({ nullable: true }).trim(),
    body('composition').optional({ nullable: true }).trim(),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];
