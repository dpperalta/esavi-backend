import { createHash } from 'crypto';
import { WhodrugApiDrug, WhodrugProductFlatRow } from '../types';

// The pure aplanado of SPEC F56 §3.5 step 4-5: ATC -> country -> holder -> form -> strength, one
// row per leaf even when a level is empty, mirroring references/external/01_transforme_v3.0.1.py:
// 34-139 without the DHIS2-only pieces (drugCode encoding, metadata identifiers, optionSets/options).
// No database, no network: a JSON in, an array of flattened rows out.

const normalizeWhitespace = (value: unknown): string => String(value ?? '').split(/\s+/).filter(Boolean).join(' ');

const toStringOrNull = (value: unknown): string | null => {
    const normalized = normalizeWhitespace(value);
    return normalized.length > 0 ? normalized : null;
};

// The search form of optionName: lowercase and stripped of diacritics via NFD decomposition. The
// service normalizes the incoming search term the same way, so this is exported for it to reuse
export const toWhodrugSearchForm = (value: string): string => value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

// ingredientTranslations (drugName), translations deduplicated case-insensitively and joined by
// '; ', per references/external/02_transforme_optionSet_v1.4.0.py:295-328. No truncation: that
// 230-character cap was a DHIS2 validation and optionName here is a varchar(500)
const buildOptionName = (drug: WhodrugApiDrug): string => {
    const drugName = normalizeWhitespace(drug.drugName);
    const seen = new Set<string>();
    const translations: string[] = [];

    for (const ingredient of drug.activeIngredients ?? []) {
        for (const translation of ingredient.ingredientTranslations ?? []) {
            const translatedName = normalizeWhitespace(translation.ingredient);
            const key = translatedName.toLowerCase();

            if (translatedName.length > 0 && !seen.has(key)) {
                seen.add(key);
                translations.push(translatedName);
            }
        }
    }

    const ingredientTranslations = translations.join('; ');

    if (ingredientTranslations.length > 0 && drugName.length > 0) {
        return `${ ingredientTranslations } (${ drugName })`;
    }

    return ingredientTranslations.length > 0 ? ingredientTranslations : drugName;
};

// All the ATCs of the medicine, replicated in every one of its rows, delimited by ';' at both ends
const buildDrugAtcs = (drug: WhodrugApiDrug): string | null => {
    const codes = (drug.atcs ?? [])
        .map((atc) => normalizeWhitespace(atc.code))
        .filter((code) => code.length > 0);

    return codes.length > 0 ? `;${ codes.join(';') };` : null;
};

// The seven fields that identify a presentation, joined by '|' with '' where the value is null, in
// the fixed order of SPEC F56 §3.1
const computeRowHash = (fields: {
    drugCode: string;
    atcCode: string | null;
    iso3Code: string | null;
    countryMedicinalProductId: string | null;
    maHoldersMedicinalProductId: string | null;
    formMedicinalProductId: string | null;
    strengthMedicinalProductId: string | null;
}): string => {
    const parts = [
        fields.drugCode,
        fields.atcCode ?? '',
        fields.iso3Code ?? '',
        fields.countryMedicinalProductId ?? '',
        fields.maHoldersMedicinalProductId ?? '',
        fields.formMedicinalProductId ?? '',
        fields.strengthMedicinalProductId ?? ''
    ];

    return createHash('sha256').update(parts.join('|')).digest('hex');
};

// One product of the download, flattened into its N leaves
const flattenWhodrugProduct = (drug: WhodrugApiDrug): WhodrugProductFlatRow[] => {
    const drugCode = toStringOrNull(drug.drugCode) ?? '';
    const drugName = normalizeWhitespace(drug.drugName);
    const medicinalProductId = toStringOrNull(drug.medicinalProductID);
    const isGeneric = Boolean(drug.isGeneric);
    const isPreferred = Boolean(drug.isPreferred);
    const drugAtcs = buildDrugAtcs(drug);
    const optionName = buildOptionName(drug);
    const optionNameSearch = toWhodrugSearchForm(optionName);

    const activeIngredients = drug.activeIngredients ?? [];
    const ingredientNames: string[] = [];
    const translationNames: string[] = [];

    if (activeIngredients.length > 0) {
        for (const ingredient of activeIngredients) {
            ingredientNames.push(normalizeWhitespace(ingredient.ingredient));

            const translations = ingredient.ingredientTranslations ?? [];
            if (translations.length > 0) {
                for (const translation of translations) {
                    translationNames.push(normalizeWhitespace(translation.ingredient));
                }
            } else {
                translationNames.push('');
            }
        }
    } else {
        ingredientNames.push('');
        translationNames.push('');
    }

    const ingredient = ingredientNames.join(';');
    const ingredientTranslations = translationNames.join(';');
    const languageCode = translationNames.some((name) => name.length > 0) ? 'es-ES' : null;

    const atcs = drug.atcs && drug.atcs.length > 0 ? drug.atcs : [null];
    const countries = drug.countryOfSales && drug.countryOfSales.length > 0 ? drug.countryOfSales : [null];

    const rows: WhodrugProductFlatRow[] = [];

    for (const atc of atcs) {
        const atcCode = atc ? toStringOrNull(atc.code) : null;

        for (const country of countries) {
            const iso3Code = country ? toStringOrNull(country.iso3Code) : null;
            const countryMedicinalProductId = country ? toStringOrNull(country.medicinalProductID) : null;
            const holders = country?.maHolders && country.maHolders.length > 0 ? country.maHolders : [null];

            for (const holder of holders) {
                const maHolders = holder ? toStringOrNull(holder.name) : null;
                const maHoldersMedicinalProductId = holder ? toStringOrNull(holder.medicinalProductID) : null;
                const forms = holder?.forms && holder.forms.length > 0 ? holder.forms : [null];

                for (const form of forms) {
                    const formValue = form ? toStringOrNull(form.form) : null;
                    const formMedicinalProductId = form ? toStringOrNull(form.medicinalProductID) : null;
                    const strengths = form?.strengths && form.strengths.length > 0 ? form.strengths : [null];

                    for (const strength of strengths) {
                        const strengthValue = strength ? toStringOrNull(strength.strength) : null;
                        const strengthMedicinalProductId = strength ? toStringOrNull(strength.medicinalProductID) : null;

                        rows.push({
                            rowHash: computeRowHash({
                                drugCode,
                                atcCode,
                                iso3Code,
                                countryMedicinalProductId,
                                maHoldersMedicinalProductId,
                                formMedicinalProductId,
                                strengthMedicinalProductId
                            }),
                            drugCode,
                            drugName,
                            drugAtcs,
                            medicinalProductId,
                            atcs: atcCode,
                            ingredient: toStringOrNull(ingredient),
                            ingredientTranslations: toStringOrNull(ingredientTranslations),
                            languageCode,
                            iso3Code,
                            countryMedicinalProductId,
                            maHolders,
                            maHoldersMedicinalProductId,
                            form: formValue,
                            formMedicinalProductId,
                            strength: strengthValue,
                            strengthMedicinalProductId,
                            isGeneric,
                            isPreferred,
                            optionName,
                            optionNameSearch
                        });
                    }
                }
            }
        }
    }

    return rows;
};

export const flattenWhodrugProducts = (drugs: WhodrugApiDrug[]): WhodrugProductFlatRow[] =>
    drugs.flatMap(flattenWhodrugProduct);
