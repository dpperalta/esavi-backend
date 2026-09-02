export interface CreateAppRoleInput {
    code: string;
    name: string;
    description: string;
    level: number;
}

// Query filters of the two listings, identical in both. name and code are the canonical
// parameters (SPEC F52), each an Op.iLike over its own column, joined with Op.or. There is no
// legacy search alias here: the entity had no text filter at all before this spec
export interface AppRoleListFilters {
    name?: string;
    code?: string;
}
