// `caseId` is required on create and immutable afterwards: the update service ignores it in
// silence even though Partial<CreateInvestigationInput> lets it through, because the fourteen
// future satellites hang from investigationId and moving the root would carry the clinical detail
// of one patient into another's file. There is no UpdateInvestigationInput — the update takes the
// Partial. `statusItemId` admits null because the client can send it that way; what it cannot do
// is get it stored like that: the service falls back to the item of code '0'
export interface CreateInvestigationInput {
    caseId: string;
    statusItemId?: string | null;
    vaccinationSiteItemId?: string | null;
    vaccinationHealthFacilityId?: string | null;
    vaccinationGeoLocationId?: string | null;
    hospitalizationDate?: string | null;
    investigationStartDate?: string | null;
    vaccinationLatitude?: number | null;
    vaccinationLongitude?: number | null;
    notes?: string | null;
    isActive?: boolean;
}

// The four query filters of 002A and 002B, accumulated with AND and by equality. Filtering by a
// foreign key that does not exist is an empty search, not a missing resource: it answers 200 with
// count 0
export interface InvestigationListFilters {
    caseId?: string;
    statusItemId?: string;
    vaccinationHealthFacilityId?: string;
    vaccinationGeoLocationId?: string;
}
