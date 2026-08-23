import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other fifteen is optional and
// nullable. That is not a relaxation: the fifteen data columns of the DDL are nullable and none of
// them makes sense as required — a medical history that has not been asked yet is a real state of
// the form, not a client error. The row opens as a draft with POST { investigationId } and gets
// completed by the PUT. It is the pattern of SPEC F13, F14 and F29, and the opposite of F30.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationMedicalHistoryInput> lets it through. Moving a medical history between
// investigations would take a patient's anamnesis to another file.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// The five answerOption fields consume the shared AnswerOption type; no enumerated type is declared
// here. birthWeightGrams is typed number on the way in — it is what the client sends — and comes
// back as a string in the response, which is what DECIMAL gives through pg
export interface CreateInvestigationMedicalHistoryInput {
    investigationId: string;
    hasPriorHospitalizationHistory?: AnswerOption | null;
    priorHospitalizationObservations?: string | null;
    hasFamilyHistory?: AnswerOption | null;
    familyHistoryObservations?: string | null;
    isPregnancyConfirmed?: AnswerOption | null;
    gestationalWeeks?: number | null;
    gestationMethodItemId?: string | null;
    deliveryItemId?: string | null;
    birthItemId?: string | null;
    pregnancyOutcomeItemId?: string | null;
    hasPregnancyRiskFactor?: AnswerOption | null;
    riskFactorDescription?: string | null;
    birthWeightGrams?: number | null;
    wasBreastfed?: AnswerOption | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself; caseId lands on the where of the investigation include, which travels
// in the query anyway to implement the inherited visibility
export interface InvestigationMedicalHistoryListFilters {
    investigationId?: string;
    caseId?: string;
}
