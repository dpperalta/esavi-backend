// code is optional: when it travels it is normalized into camelCase with toCodeFromInput, and only
// when it is absent is it minted from the name. On an update it is written exactly when it travels,
// and never re-minted from a name that changed
export interface CreateCatalogTypeInput {
    code?: string;
    name: string;
    description?: string | null;
    sortOrder?: number | null;
}

// Query filters of the two listings, identical in both. name and code are the canonical
// parameters (SPEC F52), each an Op.iLike over its own column, joined with Op.or. There is no
// legacy search alias here: the entity had no text filter at all before this spec
export interface CatalogTypeListFilters {
    name?: string;
    code?: string;
}
