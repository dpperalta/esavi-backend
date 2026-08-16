export interface CreateCatalogItemInput {
    catalogTypeId: string;
    code?: string | null;
    name: string;
    value: string;
    description?: string | null;
    sortOrder?: number | null;
    metadata?: object | null;
}

// Body of ESAVI-CATITEM-006. It carries no data column: they all come from the file. And no
// dictionaryVersion either, unlike the two importers before it — this one never writes metadata, so
// there would be nowhere to keep it, and a parameter that is accepted and discarded is worse than
// no parameter at all
export interface ImportCatalogItemsInput {
    dryRun?: boolean;
}

// The three optional columns of the file. sortOrder arrives already coerced into a valid smallint:
// the parser never hands back an invalid one, so the service has no branch for it
export interface CatalogItemFileValues {
    value: string | null;
    description: string | null;
    sortOrder: number;
}

// One accepted row. row is 1-based over the sheet, so the number points at the cell the way the
// operator sees it in Excel; row 1 is the header.
// Every text field arrives normalized from the parser and not from the service, because uniqueness
// is compared against the normalized value and it is the parser that detects the file's own
// duplicates. The two codes carry different normalizations on purpose: catalogItem.code goes through
// toConstantCase and catalogType.code through toCamelCase, which is what the two services already do
export interface ParsedCatalogItemRow {
    row: number;
    catalogTypeCode: string;
    // Only used if the type has to be created. Null is not a rejection here: the parser is pure and
    // cannot know whether the type already exists, so the service decides
    catalogTypeName: string | null;
    code: string;
    name: string;
    values: CatalogItemFileValues;
    // The cell was empty or invalid and entered as 0. Counted so the coercion is never silent
    sortOrderCoerced: boolean;
}

// One rejected row. column is filled only for VALUE_TOO_LONG — the other reasons name their column
// already. CATALOG_TYPE_NAME_REQUIRED is the only one the service emits and not the parser, so
// errors gathers rejections from two origins, both carrying their row number
export interface RejectedCatalogItemRow {
    row: number;
    reason: 'EMPTY_CATALOG_TYPE_CODE' | 'EMPTY_CODE' | 'EMPTY_NAME'
          | 'VALUE_TOO_LONG' | 'DUPLICATE_IN_FILE' | 'CATALOG_TYPE_NAME_REQUIRED';
    column?: string;
}

// What the import returns instead of a resource: the report of a process. The counters are exact;
// errors carries only the first 20 entries.
// catalogTypesCreated is the counter the other two importers do not have, and the one that matters
// most: a load that returns 1 where whoever uploaded it expected 0 is the only signal that there is
// a typo in catalogTypeCode and that a type nobody asked for has just been founded
export interface CatalogItemImportReport {
    read: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    duplicated: number;
    catalogTypesCreated: number;
    sortOrderCoerced: number;
    dryRun: boolean;
    sheet: string;
    missingOptionalHeaders: string[];
    unknownHeaders: string[];
    errors: RejectedCatalogItemRow[];
}