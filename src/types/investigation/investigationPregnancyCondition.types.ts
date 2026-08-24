import { TermSource } from '../../constants/enums.constants';

// Three input keys are not columns, and that is the direct consequence of resolving against the
// clinical master. conditionName is the text the investigator wrote: no column carries that name —
// it feeds conditionRaw, which only keeps it when it differs from the master's. And conditionCode
// and source feed the resolution and are stored nowhere in this table: the code lives in
// diagnosticTerm, which is where SPEC F15 put it.
//
// Three deliberate absences. sortOrder is not here because it is immutable and assigned by
// TRG_investigationPregnancyCondition_setSortOrder — keeping it out of the type is the cheapest
// guarantee that no service ever sends it. diagnosticTermId is not here because the client does not
// choose it: the resolution returns it, and admitting it would open the second door SPEC F16 §6
// closed. And conditionRaw is not here because it is derived — the service computes it by comparing
// what the investigator wrote against what the master says.
//
// investigationId names the medical history and not the investigation: it is the primary key of
// investigationMedicalHistory, which happens to be the same UUID because that table shares its key
// with its parent.
//
// The update uses Partial<CreateInvestigationPregnancyConditionInput>: no
// UpdateInvestigationPregnancyConditionInput exists
export interface CreateInvestigationPregnancyConditionInput {
    investigationId: string;
    conditionName: string;
    conditionCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
