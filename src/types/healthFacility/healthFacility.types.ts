export interface CreateHealthFacilityInput {
    geoLocationId: string;
    parentHealthFacilityId?: string | null;
    facilityTypeItemId?: string | null;
    localCode?: string | null;
    name: string;
    officialName?: string | null;
    shortName?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    phone?: string | null;
    email?: string | null;
    isActive?: boolean;
}

// ESAVI-HFAC-006 - Query criteria of the name-or-code search. All three are optional here:
// the validator declares them one by one and the service holds the 'at least one of name or code'
// guard, which optional() cannot express
export interface HealthFacilitySearchInput {
    name?: string;
    code?: string;
    geoLocationId?: string;
}
