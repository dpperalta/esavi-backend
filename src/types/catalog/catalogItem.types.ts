// code is optional: when it travels it is normalized into camelCase with toCodeFromInput, and only
// when it is absent does the 001 mint it from the name with toCodeFromName. The 004 writes it
// exactly when it travels and never re-mints it from a name that changed, so an item whose code was
// chosen by hand keeps it across a rename
export interface CreateCatalogItemInput {
    catalogTypeId: string;
    code?: string;
    name: string;
    value: string;
    description?: string | null;
    sortOrder?: number | null;
    metadata?: object | null;
}

// Query filters of ESAVI-CATITEM-007, the global search across catalog types. name and code are
// each an Op.iLike over their own column, joined with Op.or; at least one of the two is required —
// the guard lives in the service, because `optional()` cannot express "at least one of the two".
// catalogTypeId narrows without being a criterion on its own: it is joined with Op.and, and alone
// it is a 400, the same guard that rejects an empty search
export interface CatalogItemSearchInput {
    name?: string;
    code?: string;
    catalogTypeId?: string;
}

// Body of ESAVI-CATITEM-006. It carries no data column: they all come from the file. And no
// dictionaryVersion either, unlike the two importers before it — this one never writes metadata, so
// there would be nowhere to keep it, and a parameter that is accepted and discarded is worse than
// no parameter at all
export interface ImportCatalogItemsInput {
    dryRun?: boolean;
}

// The three optional columns of the file. sortOrder arrives already coerced into a valid smallint,
// so the service has no branch for it.
// value never arrives null, unlike description: the model declares the column allowNull: false while
// the DDL admits null, and that contradiction is not this spec's to resolve — insertion would not
// notice it, because bulkCreate does not validate, but an update emptying the cell would 500. An
// empty cell therefore carries an exact copy of the already normalized name
export interface CatalogItemFileValues {
    value: string;
    description: string | null;
    sortOrder: number;
}

// One accepted row. row is 1-based over the sheet, so the number points at the cell the way the
// operator sees it in Excel; row 1 is the header.
// Every text field arrives normalized from the parser and not from the service, because uniqueness
// is compared against the normalized value and it is the parser that detects the file's own
// duplicates. The two codes are minted differently on purpose: catalogItem.code comes from its own
// name through toCodeFromName and catalogType.code from the cell through toCamelCase, which is what
// the two services already do
export interface ParsedCatalogItemRow {
    row: number;
    catalogTypeCode: string;
    // Only used if the type has to be created. Null is not a rejection here: the parser is pure and
    // cannot know whether the type already exists, so the service decides
    catalogTypeName: string | null;
    // Never read from the sheet: minted from the normalized name
    code: string;
    name: string;
    values: CatalogItemFileValues;
    // The cell was empty or invalid and entered as 0. Counted so the coercion is never silent
    sortOrderCoerced: boolean;
}

// One rejected row. column is filled only for VALUE_TOO_LONG — the other reasons name their column
// already. CATALOG_TYPE_NAME_REQUIRED is the only one the service emits and not the parser, so
// errors gathers rejections from two origins, both carrying their row number.
// EMPTY_CODE no longer names a cell of the sheet: it is a name that mints no code, such as '---'
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