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