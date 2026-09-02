// The 28 data columns of vaccineWhodrug, writable by the create and the update.
// drugCode is required here even though the DDL admits null: a dictionary entry without a code
// cannot be crossed against anything, which is the only thing the catalog exists for. It carries
// no uniqueness — the WHODrug file repeats it by design.
// externalId is the unique key of the table and stays optional: under a Postgres UNIQUE, N rows
// with NULL coexist, so a manual entry without it never collides with the dictionary key space.
// isGeneric admits null — three states, because the DDL gave the column no DEFAULT — while
// isPreferred never does: it is NOT NULL DEFAULT false.
// metadata is deliberately absent: it is not a field the client writes. The bulk import of SPEC F19
// stamps it at insert time and not even the update touches it
export interface CreateVaccineWhodrugInput {
    drugCode: string;
    drugName: string;
    externalId?: number | null;
    drugRecNo?: string | null;
    drugRecNoSeq?: string | null;
    language?: string | null;
    medicinalProductId?: string | null;
    atcs?: string | null;
    icd11?: string | null;
    icd11Term?: string | null;
    abbreviation?: string | null;
    ingredient?: string | null;
    ingredientTranslation?: string | null;
    languageCode?: string | null;
    iso3Code?: string | null;
    countryMedicinalProductId?: string | null;
    maHolders?: string | null;
    maHoldersMedicinalProductId?: string | null;
    form?: string | null;
    formTranslations?: string | null;
    formMedicinalProductId?: string | null;
    strength?: string | null;
    strengthMedicinalProductId?: string | null;
    noDose?: string | null;
    diluent?: string | null;
    isGeneric?: boolean | null;
    isPreferred?: boolean;
    notes?: string | null;
    isActive?: boolean;
}

// Query filters of the two listings, identical in both. name and code are the canonical parameters
// (SPEC F52): name is an Op.iLike over drugName, code over drugCode, joined with Op.or. search is
// the legacy alias and feeds both columns at once. language and iso3Code are exact equality over
// the trimmed value; isPreferred and isGeneric are booleans. There is no way to filter isGeneric
// IS NULL — it would need a sentinel value in the query and nobody has asked for it
export interface VaccineWhodrugListFilters {
    search?: string;
    name?: string;
    code?: string;
    language?: string;
    iso3Code?: string;
    isPreferred?: boolean;
    isGeneric?: boolean;
}

// The five levels of the WHODrug tree navigated by ESAVI-WHODRUG-006A..006E (SPEC F54), in order:
// the position in the array is the hierarchy. Every name is the column it groups by, which is also
// the query parameter that carries it to the level below — the fourth one groups formTranslations,
// the translated form, and never form
export type VaccineWhodrugTreeLevel =
    'abbreviation' | 'drugName' | 'maHolders' | 'formTranslations' | 'strength';

// The four levels that can be an ancestor of another one, which are also the four that travel as a
// query parameter. strength is excluded because it is the leaf: nothing hangs below it
export type VaccineWhodrugTreeAncestor = Exclude<VaccineWhodrugTreeLevel, 'strength'>;

// Filters shared by the five navigation endpoints. Every ancestor is optional here because the
// first level has no parent: it is each validator that requires the immediate parent of its own
// level. country filters iso3Code — the only parameter of the five endpoints that is not named
// after its column, kept from the external backend the frontend already talks to
export interface VaccineWhodrugTreeFilters {
    country?: string;
    language?: string;
    search?: string;
    abbreviation?: string;
    drugName?: string;
    maHolders?: string;
    formTranslations?: string;
}

// One option of a level. value is null for the group of rows with no value at that level — null and
// the empty string collapse into it. vaccineWhodrugId travels resolved only when matchCount is 1,
// which is the whole point of the navigation: the frontend stops unfolding lists as soon as the
// vaccine is determined and goes straight to ESAVI-WHODRUG-003 with that id
export interface VaccineWhodrugTreeOption {
    value: string | null;
    matchCount: number;
    vaccineWhodrugId: string | null;
}

// count is the number of distinct options of the level and total the number of rows of the subset —
// the sum of the matchCount. Both are derived from the options already in memory: the level costs
// one query, not the three the external backend spends
export interface VaccineWhodrugTreeResult {
    count: number;
    total: number;
    options: VaccineWhodrugTreeOption[];
}

// Body of ESAVI-WHODRUG-007. It carries no data column: they all come from the file. There is no
// encoding either — a .xlsx is a ZIP with XML inside and the encoding is the format's business,
// not the client's
export interface ImportVaccineWhodrugsInput {
    dictionaryVersion?: string;
    dryRun?: boolean;
}

// The 24 columns the file brings beyond the key and the two required ones. notes stays out: it is
// not in the header, and isActive too — the .xlsx says nothing about currency
export type VaccineWhodrugFileValues =
    Omit<CreateVaccineWhodrugInput, 'notes' | 'isActive' | 'externalId' | 'drugCode' | 'drugName'>;

// One accepted row. row is 1-based over the sheet, so the number points at the cell the way the
// operator sees it in Excel; row 1 is the header
export interface ParsedVaccineWhodrugRow {
    row: number;
    externalId: number;
    drugCode: string;
    drugName: string;
    values: VaccineWhodrugFileValues;
}

// One rejected row. Unlike the .asc import there is no raw copy of the line: a 27-column row cut to
// 200 characters says nothing useful, and the row number plus the reason take the reviewer straight
// to the cell. column is filled only for VALUE_TOO_LONG — the other four name their column already
export interface RejectedVaccineWhodrugRow {
    row: number;
    reason: 'INVALID_EXTERNAL_ID' | 'EMPTY_DRUG_CODE' | 'EMPTY_DRUG_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_FILE';
    column?: string;
}

// What the import returns instead of a resource: the report of a process. The counters are exact;
// errors carries only the first 20 entries. sheet travels because the endpoint does not let you
// choose one, and the two header lists are how a renamed column becomes visible instead of silently
// leaving 3000 rows with a null
export interface VaccineWhodrugImportReport {
    read: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    duplicated: number;
    dryRun: boolean;
    sheet: string;
    missingOptionalHeaders: string[];
    unknownHeaders: string[];
    errors: RejectedVaccineWhodrugRow[];
}
