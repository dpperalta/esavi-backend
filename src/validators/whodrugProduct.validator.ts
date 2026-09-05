import { body, query } from 'express-validator';
import { WHODRUG_SEARCH_MAX_LIMIT, WHODRUG_SEARCH_MIN_TERM_LENGTH } from '../constants/whodrug.constants';

// ESAVI-WHODPROD-006 — the minimum of 3 keeps a stray keystroke from scanning the trigram index
// over a table of hundreds of thousands of rows; the maximum of 250 bounds what the ILIKE receives.
// limit defaults to 20 in the service and its ceiling here is the same the service enforces
export const searchWhodrugProductsValidator = [
    query('term').trim().notEmpty().withMessage('Term is required')
        .isLength({ min: WHODRUG_SEARCH_MIN_TERM_LENGTH }).withMessage(`Term must be at least ${ WHODRUG_SEARCH_MIN_TERM_LENGTH } characters long`)
        .isLength({ max: 250 }).withMessage('Term must be at most 250 characters long'),
    query('limit').optional().isInt({ min: 1, max: WHODRUG_SEARCH_MAX_LIMIT })
        .withMessage(`Limit must be an integer between 1 and ${ WHODRUG_SEARCH_MAX_LIMIT }`)
];

// ESAVI-WHODPROD-002B — inspection listing over the raw mirror, no country or ATC policy applied.
// The min of 3 on both text filters follows the same reasoning as the search's: a one- or
// two-character term against a trigram-backed table of this size is noise, not a query
export const whodrugProductListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('name').optional().trim()
        .isLength({ min: 3 }).withMessage('Name must be at least 3 characters long')
        .isLength({ max: 500 }).withMessage('Name must be at most 500 characters long'),
    query('ingredient').optional().trim()
        .isLength({ min: 3 }).withMessage('Ingredient must be at least 3 characters long')
        .isLength({ max: 500 }).withMessage('Ingredient must be at most 500 characters long')
];

// ESAVI-WHODPROD-007 — no data column: the body carries only the two knobs of the sync itself.
// dictionaryVersion is metadata, not a value that reaches candidates
export const syncWhodrugProductsValidator = [
    body('dictionaryVersion').optional().trim().notEmpty().withMessage('Dictionary Version cannot be empty')
        .isLength({ max: 100 }).withMessage('Dictionary Version must be at most 100 characters long'),
    body('dryRun').optional().isBoolean().withMessage('Dry Run must be a boolean')
];
