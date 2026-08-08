export interface CreatePatientInput {
    firstName: string;
    lastName: string;
    documentNumber: string;
    middleName?: string | null;
    secondLastName?: string | null;
    birthDate?: string | null;
    passportNumber?: string | null;
    email?: string | null;
    phoneNumber?: string | null;
    sexItemId?: string | null;
    residenceGeoLocationId?: string | null;
    isActive?: boolean;
}
