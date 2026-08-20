// code is optional: when it travels it is normalized into camelCase with toCodeFromInput, and only
// when it is absent is it minted from the name. On an update it is written exactly when it travels,
// and never re-minted from a name that changed
export interface CreateCatalogTypeInput {
    code?: string;
    name: string;
    description?: string | null;
    sortOrder?: number | null;
}
