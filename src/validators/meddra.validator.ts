import { query } from 'express-validator';

// ESAVI-MEDDRA-006 - `term` is the only parameter of the endpoint: `version`, `take` and the level
// flags travel inside ESAVI_MEDDRA_SEARCH_CONFIG and are not open to the client, because opening
// them would turn the endpoint into a console of an API that is paid per licence.
// The minimum of 3 is the plugin's own (`src/hooks/useMedDRASearch.js:6`) and exists so a stray
// keystroke does not spend a call on the licensed API; the maximum of 200 bounds what travels in
// the search body
export const searchMeddraValidator = [
    query('term').trim().notEmpty().withMessage('Term is required')
        .isLength({ min: 3 }).withMessage('Term must be at least 3 characters long')
        .isLength({ max: 200 }).withMessage('Term must be at most 200 characters long')
];
