// investigationId, isDeath and deathDate are the three required fields, and this is the first
// satellite of the repository that has any: unlike SPEC F13, F14 and F29, the row does not open
// empty and get completed by the PUT. investigationId is required because it is the primary key —
// the client brings it, the database does not generate it — and isDeath and deathDate because the
// row is the record of a fact with a date, and without the date it records nothing.
// investigationId and isDeath are immutable afterwards: the update service ignores both even
// though Partial<CreateInvestigationAutopsyInput> lets them through. Moving an autopsy between
// investigations would take a death to another patient's file, and a row that exists presupposes
// the death — isDeath: false does not turn it into something else, it contradicts it.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// The three dates travel as a 'YYYY-MM-DD' string and deathTime as 'HH:mm' or 'HH:mm:ss'; none of
// them is typed as Date. The optional fields are explicitly nullable, and that nullability
// sustains the tri-state of the two boolean ones — null and false are different data, "not
// collected" against a deliberate "no" — and lets the client erase a value already stored, not
// only change it. deathDate does not admit null, and that is the difference: it is modifiable
// because a mistyped date has to be correctable, but not erasable
export interface CreateInvestigationAutopsyInput {
    investigationId: string;
    isDeath: boolean;
    deathDate: string;
    deathTime?: string | null;
    isAutopsyPerformed?: boolean | null;
    isAutopsyScheduled?: boolean | null;
    autopsyDate?: string | null;
    scheduledAutopsyDate?: string | null;
    autopsyComments?: string | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself; caseId lands on the where of the investigation include, which travels
// in the query anyway to implement the inherited visibility
export interface InvestigationAutopsyListFilters {
    investigationId?: string;
    caseId?: string;
}
