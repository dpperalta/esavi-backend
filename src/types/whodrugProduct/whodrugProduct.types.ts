// A single leaf of the ATC -> country -> holder -> form -> strength walk, already flattened.
// There is no CreateWhodrugProductInput: the only write door is the sync (007), and what it builds
// is not a client body but this flattened row
export interface WhodrugProductFlatRow {
    rowHash: string;
    drugCode: string;
    drugName: string;
    drugAtcs?: string | null;
    medicinalProductId?: string | null;
    atcs?: string | null;
    ingredient?: string | null;
    ingredientTranslations?: string | null;
    languageCode?: string | null;
    iso3Code?: string | null;
    countryMedicinalProductId?: string | null;
    maHolders?: string | null;
    maHoldersMedicinalProductId?: string | null;
    form?: string | null;
    formMedicinalProductId?: string | null;
    strength?: string | null;
    strengthMedicinalProductId?: string | null;
    isGeneric: boolean;
    isPreferred: boolean;
    optionName: string;
    optionNameSearch: string;
}

// The contract of the regional-drugs API, typed rather than navigated blind: everything optional
// because nothing a third party sends is guaranteed. Field names and nesting mirror
// references/external/01_transforme_v3.0.1.py:34-139, the proof of concept already running in
// production — medicinalProductID keeps its capital ID because that is the literal key the API sends
export interface WhodrugApiAtc {
    code?: unknown;
    [key: string]: unknown;
}

// The API nests a translations list per ingredient, each one shaped like the ingredient itself
// (only "ingredient" is read); it stays inline here so the contract keeps exactly seven named
// interfaces, as declared in SPEC F56 §3.3
export interface WhodrugApiIngredient {
    ingredient?: unknown;
    ingredientTranslations?: { ingredient?: unknown; [key: string]: unknown }[];
    [key: string]: unknown;
}

export interface WhodrugApiStrength {
    strength?: unknown;
    medicinalProductID?: unknown;
    [key: string]: unknown;
}

export interface WhodrugApiForm {
    form?: unknown;
    medicinalProductID?: unknown;
    strengths?: WhodrugApiStrength[];
    [key: string]: unknown;
}

export interface WhodrugApiMaHolder {
    name?: unknown;
    medicinalProductID?: unknown;
    forms?: WhodrugApiForm[];
    [key: string]: unknown;
}

export interface WhodrugApiCountry {
    iso3Code?: unknown;
    medicinalProductID?: unknown;
    maHolders?: WhodrugApiMaHolder[];
    [key: string]: unknown;
}

export interface WhodrugApiDrug {
    drugCode?: unknown;
    drugName?: unknown;
    medicinalProductID?: unknown;
    isGeneric?: unknown;
    isPreferred?: unknown;
    atcs?: WhodrugApiAtc[];
    activeIngredients?: WhodrugApiIngredient[];
    countryOfSales?: WhodrugApiCountry[];
    [key: string]: unknown;
}

// The resolved configuration, in the shape of MeddraResolvedConfig (src/services/meddra.service.ts)
export interface WhodrugDownloadConfig {
    clientKey: string;
    licenseKey: string;
    downloadUrl: string;
    downloadParams: Record<string, string>;
}

export interface WhodrugSearchPolicy {
    countryIso3: string;
    excludedAtcPrefixes: string[];
}

// The 007
export interface SyncWhodrugProductsInput {
    dictionaryVersion?: string;
    dryRun?: boolean;
}

export interface RejectedWhodrugProduct {
    drugCode: string | null;
    reason: 'EMPTY_DRUG_CODE' | 'EMPTY_DRUG_NAME' | 'EMPTY_OPTION_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_DOWNLOAD';
    column?: string;
}

export interface WhodrugProductSyncReport {
    downloaded: number;
    flattened: number;
    inserted: number;
    updated: number;
    unchanged: number;
    deactivated: number;
    invalid: number;
    duplicated: number;
    dryRun: boolean;
    errors: RejectedWhodrugProduct[];
}

// The 006 and the 002B
export interface WhodrugSearchOption {
    code: string;
    name: string;
}

export interface WhodrugProductListFilters {
    name?: string;
    ingredient?: string;
    limit?: number;
    offset?: number;
}
