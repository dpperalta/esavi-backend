// `caseId` is the only required field, and it is immutable afterwards: the update service ignores
// it even though Partial<CreateFinalClassificationInput> lets it through. The other twelve are
// optional and explicitly nullable — the `| null` is what lets the client *erase* a stored value
// and not only change it, and on the eight booleans it is what sustains the tri-state in the HTTP
// contract, not only in the database. The update reuses this shape through Partial<> and
// declares no interface of its own
export interface CreateFinalClassificationInput {
    caseId: string;
    importanceAItemId?: string | null;
    importanceBItemId?: string | null;
    importanceCItemId?: string | null;
    aIsRelatedToVaccineProduct?: boolean | null;
    aIsRelatedToQualityDeviation?: boolean | null;
    aIsRelatedToProgrammaticError?: boolean | null;
    aIsRelatedToStress?: boolean | null;
    bIsConsistentTemporalRelation?: boolean | null;
    bHasDeterminantFactor?: boolean | null;
    cHasCoincidentCause?: boolean | null;
    dIsUnclassifiable?: boolean | null;
    notes?: string | null;
}

// The single query filter of 002A and 002B. Filtering by a caseId that does not exist is an empty
// search, not a missing resource: it answers 200 with count 0. There is deliberately no filter by
// any domain field — not by causality block, not by dIsUnclassifiable, not by importance
export interface FinalClassificationListFilters {
    caseId?: string;
}
