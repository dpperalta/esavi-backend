// investigationId and fullName are the two required fields: the first because a member belongs to
// an investigation and the row means nothing without it, the second because it is the only NOT NULL
// data column of the table and a team member without a name records nothing.
// Two columns of the table are deliberately absent from this interface. investigationTeamMemberId
// is minted by the database — unlike investigationSource and investigationAutopsy, where the client
// brought the primary key because it was the foreign key. And sortOrder is immutable and assigned
// by TRG_investigationTeamMember_setSortOrder: that it does not exist in the type is the cheapest
// guarantee that no service will ever send it. isActive is absent for the same reason as in the
// other entities — 005A and 005B govern it, never the create or the update.
// investigationId is immutable after the create: the update service ignores it in silence even
// though Partial<CreateInvestigationTeamMemberInput> lets it through, because a member does not
// move between investigations.
// The four optional fields are explicitly nullable, and that nullability is what lets the client
// erase a value already stored and not only change it. fullName does not admit null, and that is
// the difference: a name is correctable, but a member without one is a 400 from the validator.
// No constant is needed here: this entity references no catalog. No UpdateInvestigationTeamMember-
// Input is declared either — the update consumes Partial<CreateInvestigationTeamMemberInput>
export interface CreateInvestigationTeamMemberInput {
    investigationId: string;
    fullName: string;
    institutionName?: string | null;
    email?: string | null;
    phone?: string | null;
    notes?: string | null;
}
