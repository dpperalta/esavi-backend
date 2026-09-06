import { flattenWhodrugProducts, toWhodrugSearchForm } from '../../src/helpers/whodrugFlatten.helper';
import { WhodrugApiDrug } from '../../src/types';

// Three products, matching SPEC F56 §4 step 7's fixture: one with no countryOfSales, one with two
// ATCs, one with no translations at all
const fixture: WhodrugApiDrug[] = [
    {
        drugCode: 'A001',
        drugName: 'Paracetamol',
        medicinalProductID: 'MP-A001',
        isGeneric: true,
        isPreferred: false,
        atcs: [{ code: 'N02BE01' }],
        activeIngredients: [
            {
                ingredient: 'Paracetamol',
                ingredientTranslations: [{ ingredient: 'Paracetamol' }]
            }
        ]
        // no countryOfSales
    },
    {
        drugCode: 'B002',
        drugName: 'ComboVax',
        medicinalProductID: 'MP-B002',
        isGeneric: false,
        isPreferred: true,
        atcs: [{ code: 'J07AN01' }, { code: 'L03AX' }],
        activeIngredients: [
            {
                ingredient: 'Ingredient B',
                ingredientTranslations: [{ ingredient: 'Ingrediente B' }]
            }
        ],
        countryOfSales: [
            {
                iso3Code: 'ECU',
                medicinalProductID: 'MP-B002-ECU',
                maHolders: [
                    {
                        name: 'Holder B',
                        medicinalProductID: 'MP-B002-ECU-H',
                        forms: [
                            {
                                form: 'Solution',
                                medicinalProductID: 'MP-B002-ECU-H-F',
                                strengths: [{ strength: '10mg', medicinalProductID: 'MP-B002-ECU-H-F-S' }]
                            }
                        ]
                    }
                ]
            }
        ]
    },
    {
        drugCode: 'C003',
        drugName: 'Ibuprofen',
        medicinalProductID: 'MP-C003',
        isGeneric: true,
        isPreferred: false,
        atcs: [{ code: 'M01AE01' }],
        activeIngredients: [
            { ingredient: 'Ibuprofen' }
        ],
        countryOfSales: [
            { iso3Code: 'ECU', medicinalProductID: 'MP-C003-ECU' }
        ]
    }
];

describe('flattenWhodrugProducts', () => {

    it('produces one row for a drug with no countryOfSales', () => {
        const rows = flattenWhodrugProducts([fixture[0]]);
        expect(rows).toHaveLength(1);
        expect(rows[0].drugCode).toBe('A001');
        expect(rows[0].iso3Code).toBeNull();
        expect(rows[0].optionName).toBe('Paracetamol (Paracetamol)');
    });

    it('replicates every ATC of the medicine into drugAtcs on every one of its rows', () => {
        const rows = flattenWhodrugProducts([fixture[1]]);
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.drugAtcs === ';J07AN01;L03AX;')).toBe(true);
        expect(rows.map((row) => row.atcs).sort()).toEqual(['J07AN01', 'L03AX']);
    });

    it('produces a row with a null languageCode when the drug carries no translation', () => {
        const rows = flattenWhodrugProducts([fixture[2]]);
        expect(rows).toHaveLength(1);
        expect(rows[0].languageCode).toBeNull();
        expect(rows[0].ingredientTranslations).toBeNull();
    });

    it('produces the expected total row count for the fixture', () => {
        const rows = flattenWhodrugProducts(fixture);
        expect(rows).toHaveLength(1 + 2 + 1);
    });

    it('is deterministic: flattening the same fixture twice yields the same rowHash values', () => {
        const first = flattenWhodrugProducts(fixture).map((row) => row.rowHash);
        const second = flattenWhodrugProducts(fixture).map((row) => row.rowHash);
        expect(second).toEqual(first);
    });

    it('gives every row a distinct rowHash within the same download', () => {
        const hashes = flattenWhodrugProducts(fixture).map((row) => row.rowHash);
        expect(new Set(hashes).size).toBe(hashes.length);
    });
});

describe('toWhodrugSearchForm', () => {

    it('lowercases and strips diacritics so accented and plain spellings match', () => {
        expect(toWhodrugSearchForm('Paracetamol')).toBe(toWhodrugSearchForm('paracetamol'));
        expect(toWhodrugSearchForm('Ibuprofeno (genérico)')).toBe('ibuprofeno (generico)');
    });
});
