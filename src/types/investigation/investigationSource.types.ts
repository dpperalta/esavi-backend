// investigationId is the only required field, and it is required precisely because it is the
// primary key: the client brings it, the database does not generate it. It is immutable
// afterwards — the update service ignores it even though Partial<CreateInvestigationSourceInput>
// lets it through, since a source is the record of how *that* investigation was carried out and
// moving it would take the provenance of the information to another patient's file.
// Like the two notification satellites, this input declares no activity flag: the table does not
// have that column and this entity does not manage its own state — its investigation does.
// The ten remaining fields are optional and explicitly nullable, and that nullability sustains the
// tri-state of the eight boolean ones — null and false are different data, "not collected" against
// a deliberate "no" — and lets the client erase an answer already given, not only change it
export interface CreateInvestigationSourceInput {
    investigationId: string;
    history?: boolean | null;
    interviewVaccinatedPerson?: boolean | null;
    interviewHealthWorker?: boolean | null;
    vaccinationRecord?: boolean | null;
    autopsyRecord?: boolean | null;
    verbalAutopsyRecord?: boolean | null;
    investigationReport?: boolean | null;
    other?: boolean | null;
    otherDescription?: string | null;
    notes?: string | null;
}
