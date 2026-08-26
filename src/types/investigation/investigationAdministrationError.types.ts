import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other twenty six is optional and
// nullable. That is not a relaxation: the twenty six data columns of the DDL are nullable and none
// of them makes sense as required — there is nothing the investigator is obliged to know in order to
// open the row. It opens as a draft with POST { investigationId } and gets completed by the PUT. It
// is the pattern of SPEC F13, F14, F29, F32, F34, F36 and F38, and this is the widest satellite
// specified so far: twenty six data columns against the fifteen of investigationColdChain.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationAdministrationErrorInput> lets it through. An administration error is
// not moved between investigations.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// THE FOUR SYRINGE TYPES ARE boolean | null AND NOT AnswerOption | null, while the flag that governs
// them is AnswerOption | null. It is the asymmetry of the DDL (esaviapp.sql:1202-1207) carried into
// the contract without softening it: the four have three states and the twelve answers have five,
// the flag and the four types live inside the same block, and nothing translates between them. The
// twelve consume the shared AnswerOption type; no enumerated type is declared here
export interface CreateInvestigationAdministrationErrorInput {
    investigationId: string;
    usedAutoDisableSyringes?: AnswerOption | null;
    usedGlassSyringes?: boolean | null;
    usedDisposableSyringes?: boolean | null;
    usedRecycledDisposableSyringes?: boolean | null;
    usedOtherSyringes?: boolean | null;
    otherSyringesDescription?: string | null;
    syringesKeyFindings?: string | null;
    reconstitutionUsedSameSyringe?: AnswerOption | null;
    reconstitutionUsedSameSyringeDifferentVaccine?: AnswerOption | null;
    reconstitutionUsedDifferentSyringeSameVial?: AnswerOption | null;
    reconstitutionUsedDifferentSyringeDifferentVaccine?: AnswerOption | null;
    reconstitutionFollowedManufacturerRecommendation?: AnswerOption | null;
    reconstitutionKeyFindings?: string | null;
    hadPrescriptionError?: AnswerOption | null;
    prescriptionErrorNotes?: string | null;
    hadContaminatedVaccine?: AnswerOption | null;
    contaminatedVaccineNotes?: string | null;
    hadAbnormalVaccineConditions?: AnswerOption | null;
    abnormalConditionsNotes?: string | null;
    hadPreparationError?: AnswerOption | null;
    preparationErrorNotes?: string | null;
    hadHandlingError?: AnswerOption | null;
    handlingErrorNotes?: string | null;
    hadImproperAdministration?: AnswerOption | null;
    improperAdministrationNotes?: string | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself — no index has to be added for it, because the primary key already is
// one; caseId lands on the where of the investigation include, which travels in the query anyway to
// implement the inherited visibility.
// There is no filter over any domain column — syringe type, reconstitution practice, any of the six
// concrete errors — and there will not be one: it would be the first of the repository and opens the
// door to dashboards, which SPEC F39 §2 leaves out. These two are the same filters as SPEC F29, F32,
// F34, F36 and F38
export interface InvestigationAdministrationErrorListFilters {
    investigationId?: string;
    caseId?: string;
}
