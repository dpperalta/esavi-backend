import { body, param, query } from 'express-validator';

export const vaccineWhodrugIdValidator = [
    param('id').notEmpty().withMessage('Vaccine WHODrug ID is required')
        .isUUID().withMessage('Vaccine WHODrug ID must be a valid UUID')
        .trim()
];

// Query validator shared by both listings — they take exactly the same five filters. The two
// character minimum on search is what keeps the unindexed Op.iLike from scanning the whole catalog
// on a single letter; the GIN index IX_vaccineWhodrug_name is deliberately not used, so that
// minimum and the ceiling of 100 rows are what bound the cost
export const vaccineWhodrugListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer'),
    query('search').optional().trim()
        .isLength({ min: 2 }).withMessage('Search must be at least 2 characters long')
        .isLength({ max: 500 }).withMessage('Search must be at most 500 characters long'),
    query('language').optional().trim().notEmpty().withMessage('Language cannot be empty')
        .isLength({ max: 10 }).withMessage('Language must be at most 10 characters long'),
    query('iso3Code').optional().trim().notEmpty().withMessage('ISO3 Code cannot be empty')
        .isLength({ max: 250 }).withMessage('ISO3 Code must be at most 250 characters long'),
    query('isPreferred').optional().isBoolean().withMessage('Is Preferred must be a boolean'),
    query('isGeneric').optional().isBoolean().withMessage('Is Generic must be a boolean')
];

// drugCode is required here even though esaviapp.sql:564 admits null: a dictionary entry without a
// code cannot be crossed against anything, which is the only thing the catalog exists for. It
// carries no uniqueness — the WHODrug file repeats it by design, one row per country presentation.
// The 26 optional fields admit null explicitly, which is how a column is emptied and is a different
// intent from omitting the key. Every isLength ceiling matches the varchar width of the DDL; the
// text columns declare none because the column declares none.
// metadata is deliberately absent: it is not a field the client writes — the bulk import of
// SPEC F19 stamps it at insert time and nobody else touches it
export const createVaccineWhodrugValidator = [
    body('drugCode').trim().notEmpty().withMessage('Drug Code is required')
        .isLength({ max: 250 }).withMessage('Drug Code must be at most 250 characters long'),
    body('drugName').trim().notEmpty().withMessage('Drug Name is required'),
    body('externalId').optional({ nullable: true }).isInt()
        .withMessage('External ID must be an integer'),
    body('drugRecNo').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Drug Rec No must be at most 50 characters long'),
    body('drugRecNoSeq').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Drug Rec No Seq must be at most 50 characters long'),
    body('language').optional({ nullable: true }).trim()
        .isLength({ max: 10 }).withMessage('Language must be at most 10 characters long'),
    body('medicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Medicinal Product ID must be at most 250 characters long'),
    body('atcs').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ATCs must be at most 250 characters long'),
    body('icd11').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ICD-11 must be at most 250 characters long'),
    body('icd11Term').optional({ nullable: true }).trim()
        .isLength({ max: 500 }).withMessage('ICD-11 Term must be at most 500 characters long'),
    body('abbreviation').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Abbreviation must be at most 250 characters long'),
    body('ingredient').optional({ nullable: true }).trim(),
    body('ingredientTranslation').optional({ nullable: true }).trim(),
    // Distinct from language and of a different width: they are two separate headers of the source
    // dump, not a duplicate to reconcile
    body('languageCode').optional({ nullable: true }).trim()
        .isLength({ max: 100 }).withMessage('Language Code must be at most 100 characters long'),
    body('iso3Code').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ISO3 Code must be at most 250 characters long'),
    body('countryMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Country Medicinal Product ID must be at most 250 characters long'),
    body('maHolders').optional({ nullable: true }).trim(),
    body('maHoldersMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('MA Holders Medicinal Product ID must be at most 250 characters long'),
    body('form').optional({ nullable: true }).trim(),
    body('formTranslations').optional({ nullable: true }).trim(),
    body('formMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Form Medicinal Product ID must be at most 250 characters long'),
    body('strength').optional({ nullable: true }).trim(),
    body('strengthMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Strength Medicinal Product ID must be at most 250 characters long'),
    body('noDose').optional({ nullable: true }).trim(),
    // Free text, not a foreign key to diluentCatalog: the column is text and it is validated as text
    body('diluent').optional({ nullable: true }).trim(),
    // Nullable on purpose — true, false and null are three distinct values, because the DDL gave
    // the column no DEFAULT
    body('isGeneric').optional({ nullable: true }).isBoolean().withMessage('Is Generic must be a boolean'),
    // NOT NULL in the DDL: null is not a valid value in any layer, so no { nullable: true } here
    body('isPreferred').optional().isBoolean().withMessage('Is Preferred must be a boolean'),
    body('notes').optional({ nullable: true }).trim(),
    body('isActive').optional().isBoolean().withMessage('Is Active must be a boolean')
];

// The create validator in its optional variant: drugCode and drugName stop being required but may
// not arrive empty, and the other 26 fields keep exactly the same rules. Both are mutable — a typo
// in a manually entered code has to be fixable — and neither carries uniqueness; only externalId
// does, and the service checks it before the diff.
// isActive is accepted and ignored: activation belongs to 005A and 005B, and rejecting a client
// that resends its own GET response would turn a field nobody meant to change into a 400.
// metadata is absent for the same reason as in the create
export const updateVaccineWhodrugValidator = [
    body('drugCode').optional().trim().notEmpty().withMessage('Drug Code cannot be empty')
        .isLength({ max: 250 }).withMessage('Drug Code must be at most 250 characters long'),
    body('drugName').optional().trim().notEmpty().withMessage('Drug Name cannot be empty'),
    body('externalId').optional({ nullable: true }).isInt()
        .withMessage('External ID must be an integer'),
    body('drugRecNo').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Drug Rec No must be at most 50 characters long'),
    body('drugRecNoSeq').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Drug Rec No Seq must be at most 50 characters long'),
    body('language').optional({ nullable: true }).trim()
        .isLength({ max: 10 }).withMessage('Language must be at most 10 characters long'),
    body('medicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Medicinal Product ID must be at most 250 characters long'),
    body('atcs').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ATCs must be at most 250 characters long'),
    body('icd11').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ICD-11 must be at most 250 characters long'),
    body('icd11Term').optional({ nullable: true }).trim()
        .isLength({ max: 500 }).withMessage('ICD-11 Term must be at most 500 characters long'),
    body('abbreviation').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Abbreviation must be at most 250 characters long'),
    body('ingredient').optional({ nullable: true }).trim(),
    body('ingredientTranslation').optional({ nullable: true }).trim(),
    body('languageCode').optional({ nullable: true }).trim()
        .isLength({ max: 100 }).withMessage('Language Code must be at most 100 characters long'),
    body('iso3Code').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('ISO3 Code must be at most 250 characters long'),
    body('countryMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Country Medicinal Product ID must be at most 250 characters long'),
    body('maHolders').optional({ nullable: true }).trim(),
    body('maHoldersMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('MA Holders Medicinal Product ID must be at most 250 characters long'),
    body('form').optional({ nullable: true }).trim(),
    body('formTranslations').optional({ nullable: true }).trim(),
    body('formMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Form Medicinal Product ID must be at most 250 characters long'),
    body('strength').optional({ nullable: true }).trim(),
    body('strengthMedicinalProductId').optional({ nullable: true }).trim()
        .isLength({ max: 250 }).withMessage('Strength Medicinal Product ID must be at most 250 characters long'),
    body('noDose').optional({ nullable: true }).trim(),
    body('diluent').optional({ nullable: true }).trim(),
    body('isGeneric').optional({ nullable: true }).isBoolean().withMessage('Is Generic must be a boolean'),
    body('isPreferred').optional().isBoolean().withMessage('Is Preferred must be a boolean'),
    body('notes').optional({ nullable: true }).trim()
];
