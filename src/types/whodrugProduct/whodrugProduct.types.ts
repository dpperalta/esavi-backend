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
// because nothing a third party sends is guaranteed
export interface WhodrugApiAtc {
    atc?: unknown;
    [key: string]: unknown;
}

export interface WhodrugApiIngredient {
    ingredient?: unknown;
    ingredientTranslation?: unknown;
    [key: string]: unknown;
}

export interface WhodrugApiMaHolder {
    maHolder?: unknown;
    medicinalProductId?: unknown;
    [key: string]: unknown;
}

export interface WhodrugApiForm {
    form?: unknown;
    medicinalProductId?: unknown;
    strengths?: WhodrugApiStrength[];
    [key: string]: unknown;
}

export interface WhodrugApiStrength {
    strength?: unknown;
    medicinalProductId?: unknown;
    [key: string]: unknown;
}

export interface WhodrugApiCountry {
    iso3Code?: unknown;
    medicinalProductId?: unknown;
    maHolders?: WhodrugApiMaHolder[];
    [key: string]: unknown;
}

export interface WhodrugApiDrug {
    drugCode?: unknown;
    drugName?: unknown;
    isGeneric?: unknown;
    atcs?: WhodrugApiAtc[];
    ingredients?: WhodrugApiIngredient[];
    countryOfSales?: WhodrugApiCountry[];
    forms?: WhodrugApiForm[];
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
