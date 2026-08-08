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
