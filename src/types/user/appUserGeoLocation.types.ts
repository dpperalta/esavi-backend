export interface CreateAppUserGeoLocationInput {
    userId: string;
    geoLocationId: string;
    validFrom?: string | Date;        // defaults to now() in the service
    validTo?: string | Date | null;   // null = open-ended validity
    isActive?: boolean;
}

export interface BulkAssignGeoLocationsInput {
    userId: string;
    geoLocationIds: string[];
    validFrom?: string | Date;
    validTo?: string | Date | null;
}

export interface ReassignGeoLocationInput {
    geoLocationId: string;            // target geoLocation
}
