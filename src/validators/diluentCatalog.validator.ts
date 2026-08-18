import { body } from 'express-validator';

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
