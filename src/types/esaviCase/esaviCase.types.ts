// `caseCode` is deliberately absent: the service generates it. If the client sends it, it is ignored
export interface CreateEsaviCaseInput {
    patientId: string;
    healthFacilityId: string;
    reportDate?: string | null;
    eventDate?: string | null;
    countryIsoCode?: string | null;
    reportFillingDate?: string | null;
    notificationOrganization?: string | null;
    details?: string | null;
    isActive?: boolean;
}

// The query filters of 002A and 002B, accumulated with AND. Filtering by a foreign key
// that does not exist is an empty search, not a missing resource: it answers 200 with count 0.
// `geoLocationId` matches the whole active subtree of that unit, not only the unit itself.
// Each date column takes either its exact form or its From/To range: the two are mutually
// exclusive per column, rejected with 400 in the validator. All values arrive as strings
// from req.query and are normalized in the service
export interface EsaviCaseListFilters {
    patientId?: string;
    healthFacilityId?: string;
    geoLocationId?: string;
    reportDate?: string;
    reportDateFrom?: string;
    reportDateTo?: string;
    eventDate?: string;
    eventDateFrom?: string;
    eventDateTo?: string;
    reportFillingDate?: string;
    reportFillingDateFrom?: string;
    reportFillingDateTo?: string;
}
