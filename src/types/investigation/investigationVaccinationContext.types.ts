import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other eleven is optional and
// nullable. That is not a relaxation: the eleven data columns of the DDL are nullable and none of
// them makes sense as required — a vaccination context that has not been filled in yet is a real
// state of the form, not a client error. The row opens as a draft with POST { investigationId } and
// gets completed by the PUT. It is the pattern of SPEC F13, F14, F29, F32 and F34.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationVaccinationContextInput> lets it through. Moving a vaccination context
// between investigations would take one session's circumstances to another file.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// isCluster and clusterUsedSameVial consume the shared AnswerOption type; no enumerated type is
// declared here. The four counters are numbers and 0 is a valid value for every one of them
export interface CreateInvestigationVaccinationContextInput {
    investigationId: string;
    momentItemId?: string | null;
    multidoseItemId?: string | null;
    vaccinatedPerVialCount?: number | null;
    vaccinatedPerBatchCount?: number | null;
    locations?: string | null;
    isCluster?: AnswerOption | null;
    clusterIdentificationNumber?: string | null;
    clusterAdditionalCaseCount?: number | null;
    clusterUsedSameVial?: AnswerOption | null;
    clusterSameVialCount?: number | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself — no index has to be added for it, because the primary key already is
// one; caseId lands on the where of the investigation include, which travels in the query anyway to
// implement the inherited visibility.
// There is no filter over isCluster and there will not be one: filtering by a domain value would be
// the first of the repository and opens the door to dashboards, which SPEC F36 §2 leaves out
export interface InvestigationVaccinationContextListFilters {
    investigationId?: string;
    caseId?: string;
}
