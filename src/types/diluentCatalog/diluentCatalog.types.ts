// The 4 data columns of diluentCatalog, writable by the create and the update.
// code is required here even though the DDL admits null: a diluent without a code cannot be crossed
// against anything, which is the only thing a master exists for. An API stricter than the schema is
// the safe direction. Its uniqueness is global, over a single column, and does not filter by
// isActive — a code taken by a deactivated row stays taken.
// description and composition are string | null: null is the value a column is emptied with, which
// is not the same as omitting the key.
// The update uses Partial<CreateDiluentCatalogInput>; no UpdateDiluentCatalogInput is declared
export interface CreateDiluentCatalogInput {
    code: string;
    name: string;
    description?: string | null;
    composition?: string | null;
    isActive?: boolean;
}

// Query filters of the two listings, identical in both. name and code are the canonical parameters
// (SPEC F52), each an Op.iLike over its own column; search is the legacy alias and feeds both at
// once. There is no other filter: the table has no column that could serve as a facet —
// description and composition are long text, and there is no manufacturer, presentation or type
export interface DiluentCatalogListFilters {
    search?: string;
    name?: string;
    code?: string;
}
