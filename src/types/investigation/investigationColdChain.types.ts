import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other fifteen is optional and
// nullable. That is not a relaxation: the fifteen data columns of the DDL are nullable and none of
// them makes sense as required — there is nothing the investigator is obliged to know in order to
// open the row. It opens as a draft with POST { investigationId } and gets completed by the PUT. It
// is the pattern of SPEC F13, F14, F29, F32, F34 and F36.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationColdChainInput> lets it through. A cold chain is not moved between
// investigations.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// THE FIRST TWO ARE boolean | null AND NOT AnswerOption | null. It is the asymmetry of the DDL
// (esaviapp.sql:1177-1178) carried into the contract without softening it: the flag has three states
// and the eight answers have five, they live in the same storage section, and nothing translates
// between them. The eight consume the shared AnswerOption type; no enumerated type is declared here
export interface CreateInvestigationColdChainInput {
    investigationId: string;
    storageTemperatureMonitored?: boolean | null;
    storageRangeDeviation?: boolean | null;
    storageProcedureFollowed?: AnswerOption | null;
    storageOtherObjectPresent?: AnswerOption | null;
    storagePartiallyReconstitutedVaccine?: AnswerOption | null;
    storageVaccineNotUsable?: AnswerOption | null;
    storageDiluentNotUsable?: AnswerOption | null;
    storageKeyFindings?: string | null;
    transportUsedThermos?: AnswerOption | null;
    transportSetInThermos?: AnswerOption | null;
    transportReturnedInThermos?: AnswerOption | null;
    transportUsedColdPack?: AnswerOption | null;
    transportTypeThermo?: string | null;
    transportKeyFindings?: string | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself — no index has to be added for it, because the primary key already is
// one; caseId lands on the where of the investigation include, which travels in the query anyway to
// implement the inherited visibility.
// There is no filter over any domain column — deviation of range, container type, findings — and
// there will not be one: it would be the first of the repository and opens the door to dashboards,
// which SPEC F38 §2 leaves out. These two are the same filters as SPEC F29, F32, F34 and F36
export interface InvestigationColdChainListFilters {
    investigationId?: string;
    caseId?: string;
}
