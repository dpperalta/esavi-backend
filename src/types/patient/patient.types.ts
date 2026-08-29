export interface CreatePatientInput {
    names: string;
    lastNames: string;
    documentNumber: string;
    birthDate?: string | null;
    passportNumber?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    sexItemId?: string | null;
    residenceGeoLocationId?: string | null;
    isActive?: boolean;
}
