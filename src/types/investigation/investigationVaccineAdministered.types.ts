// investigationId and vaccineWhodrugId are the two required fields: the first because an
// administered vaccine belongs to an investigation and the row means nothing without it, the second
// because a vaccine that is not identified against the WHODrug dictionary records nothing that can
// be crossed against anything. vaccineWhodrugId is declared string and not string | null even
// though the DDL admits the null: the type says what the application demands, not what the column
// tolerates.
// Three columns of the table are deliberately absent from this interface. vaccineAdministeredId is
// minted by the database, sortOrder is immutable and assigned by the trigger, and isActive is
// governed by 005A and 005B. That none of them exists in the type is the cheapest guarantee that no
// service will ever send them.
// investigationId is immutable after the create: the update service ignores it in silence even
// though Partial<CreateInvestigationVaccineAdministeredInput> lets it through, because an
// administered vaccine does not move between investigations.
// The two optional fields are explicitly nullable, and that nullability is what lets the client
// erase a value already stored and not only change it. vaccineWhodrugId does not admit null, and
// that is the difference: it is correctable, but never erasable - in the update, optional in the
// body is not optional in the result. Absent means "do not touch it", an explicit null means
// "erase it", and that is what the 004 rejects with a 400 evaluated over the resulting state.
// No constant is needed here: the master is not a catalog and there is no double hop to make. No
// UpdateInvestigationVaccineAdministeredInput is declared either - the update consumes
// Partial<CreateInvestigationVaccineAdministeredInput>
export interface CreateInvestigationVaccineAdministeredInput {
    investigationId: string;
    vaccineWhodrugId: string;
    doseNumber?: number | null;
    notes?: string | null;
}
