// `caseId` is required on create and immutable afterwards: the update service ignores it even
// though Partial<CreateClassificationInput> lets it through. `age` and `ageUnitItemId` stay in
// the input although they are almost always ignored: they are the fallback for when
// patient.birthDate or esaviCase.eventDate is missing, which this schema allows. The nine
// booleans admit null explicitly, which is what sustains the tri-state
export interface CreateClassificationInput {
    caseId: string;
    age?: number | null;
    ageUnitItemId?: string | null;
    firstConsultationDate?: string | null;
    isSeriousEvent?: boolean | null;
    causedDeath?: boolean | null;
    causedDisability?: boolean | null;
    causedCongenitalAnomaly?: boolean | null;
    causedFetalDeath?: boolean | null;
    causedLifeThreatening?: boolean | null;
    causedHospitalization?: boolean | null;
    causedAbortion?: boolean | null;
    causedOtherCondition?: boolean | null;
    otherSeriousConditionDescription?: string | null;
    notes?: string | null;
    isActive?: boolean;
}

// The three query filters of 002A and 002B, accumulated with AND. Filtering by a foreign key
// that does not exist is an empty search, not a missing resource: it answers 200 with count 0.
// isSeriousEvent admits only true or false — there is no way to filter by "not informed"
export interface ClassificationListFilters {
    caseId?: string;
    isSeriousEvent?: boolean;
    ageUnitItemId?: string;
}
