import { AnswerOption } from '../../constants/enums.constants';

// investigationId is the only required field, and every one of the other sixteen is optional and
// nullable. That is not a relaxation: the sixteen data columns of the DDL are nullable and none of
// them makes sense as required — a clinical evaluation that has not been filled in yet is a real
// state of the form, not a client error. The row opens as a draft with POST { investigationId } and
// gets completed by the PUT. It is the pattern of SPEC F13, F14, F29 and F32.
// The explicit | null is what lets the client erase a value already stored, and not only change it.
// investigationId is immutable afterwards: the update service ignores it even though
// Partial<CreateInvestigationClinicalEvaluationInput> lets it through. Moving a clinical evaluation
// between investigations would take a patient's assessment to another file.
// Like the other satellites, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state — its investigation does.
// receivedMedicalAttention consumes the shared AnswerOption type; no enumerated type is declared
// here. clinicalDetailsPersonName is string on the way in and string on the way out, both times in
// PLAIN TEXT: the ciphertext never crosses the HTTP boundary nor appears in any interface, exactly
// as SPEC F04, F05 and F07 do
export interface CreateInvestigationClinicalEvaluationInput {
    investigationId: string;
    receivedMedicalAttention?: AnswerOption | null;
    sourceExam?: boolean | null;
    sourceDocuments?: boolean | null;
    sourceVerbalAutopsy?: boolean | null;
    sourceOther?: boolean | null;
    otherDescription?: string | null;
    suspectedChildAbuse?: boolean | null;
    childAbuseExplanation?: string | null;
    suspectedDomesticViolence?: boolean | null;
    domesticViolenceExplanation?: string | null;
    clinicalDetailsPersonName?: string | null;
    familyClinicalDetails?: string | null;
    completeClinicalSummary?: string | null;
    signsAndSymptoms?: string | null;
    otherSocialBackground?: string | null;
    notes?: string | null;
}

// The two filters of 002A and 002B, accumulative with AND and by equality. investigationId lands
// on the primary key itself; caseId lands on the where of the investigation include, which travels
// in the query anyway to implement the inherited visibility.
// There is no filter over clinicalDetailsPersonName and there never will be while it is encrypted:
// over a fixed-IV ciphertext only exact equality is possible, and no use case asks for it
export interface InvestigationClinicalEvaluationListFilters {
    investigationId?: string;
    caseId?: string;
}
