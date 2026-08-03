export interface CreateGeoLocationInput {
    geoLevelTypeId: string;
    parentGeoLocationId?: string | null;
    name: string;
    shortName?: string | null;
    officialName?: string | null;
    isoCode?: string | null;
    externalCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    sortOrder?: number | null;
    level?: number | null;
    geoPolygon?: object | null;
}