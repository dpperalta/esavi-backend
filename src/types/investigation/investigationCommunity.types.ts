import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other ten is optional and
// nullable. That is not a relaxation: the ten data columns of the DDL are nullable and none of them
// makes sense as required — there is nothing the investigator is obliged to know in order to open
// the row. It opens as a draft with POST { investigationId } and gets completed by the PUT. It is
// the pattern of SPEC F13, F14, F29, F32, F34, F36, F38 and F39.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationCommunityInput> lets it through. A community record is not moved
// between investigations.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// THE TWO COORDINATES ARE DECLARED number | null even though pg hands them back as strings. It is
// what SPEC F28 did with its own, and the numeric comparison of the differential helper is what
// absorbs the difference in the 004. THE FOUR COUNTERS ARE number | null TOO: they are smallint in
// the DDL, and the validator replicates both the CHECK >= 0 and the 32767 ceiling so an overflow is
// a 400 and not a 500 from Postgres.
// hadSimilarEvent consumes the shared AnswerOption type; no enumerated type is declared here
export interface CreateInvestigationCommunityInput {
    investigationId: string;
    patientLatitude?: number | null;
    patientLongitude?: number | null;
    hadSimilarEvent?: AnswerOption | null;
    similarEventDescription?: string | null;
    similarEventCount?: number | null;
    affectedVaccinated?: number | null;
    affectedUnvaccinated?: number | null;
    affectedUnknown?: number | null;
    otherComments?: string | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself — no index has to be added for it, because the primary key already is
// one; caseId lands on the where of the investigation include, which travels in the query anyway to
// implement the inherited visibility.
// There is no filter over any domain column — the similar event flag, the counters, the home
// coordinates — and there will not be one: it would open the door to dashboards and to the first
// geospatial query of the repository, both of which SPEC F40 §2 leaves out. These two are the same
// filters as SPEC F29, F32, F34, F36, F38 and F39
export interface InvestigationCommunityListFilters {
    investigationId?: string;
    caseId?: string;
}
