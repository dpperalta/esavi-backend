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

// The three query filters of 002A and 002B, accumulated with AND. Filtering by a foreign key
// that does not exist is an empty search, not a missing resource: it answers 200 with count 0
export interface EsaviCaseListFilters {
    patientId?: string;
    healthFacilityId?: string;
    reportDateFrom?: string;
    reportDateTo?: string;
}
