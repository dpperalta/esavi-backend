// `caseId` is required on create and immutable afterwards: the update service ignores it even
// though Partial<CreateNotifierInput> lets it through. `lastName` is required by the application
// although the DDL allows it null: a notifier with only a given name identifies nobody
export interface CreateNotifierInput {
    caseId: string;
    firstName: string;
    lastName: string;
    professionItemId?: string | null;
    geoLocationId?: string | null;
    room?: string | null;
    address?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
    details?: string | null;
    isActive?: boolean;
}

// The three query filters of 002A and 002B, accumulated with AND. Filtering by a foreign key
// that does not exist is an empty search, not a missing resource: it answers 200 with count 0
export interface NotifierListFilters {
    caseId?: string;
    professionItemId?: string;
    geoLocationId?: string;
}
