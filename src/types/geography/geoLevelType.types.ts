export interface CreateGeoLevelTypeInput {
    code: string;
    name: string;
    sortOrder: number;
}

// Query filters of the two listings, identical in both. name and code are the canonical
// parameters (SPEC F52), each an Op.iLike over its own column, joined with Op.or. There is no
// legacy search alias here: the entity had no text filter at all before this spec
export interface GeoLevelTypeListFilters {
    name?: string;
    code?: string;
}