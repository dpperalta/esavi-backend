import { TermSource } from '../../constants/enums.constants';

// Three input keys are not columns, and that is the direct consequence of resolving against the
// clinical master. diagnosticName is the text the investigator wrote: no column carries that name —
// it feeds diagnosticRaw, which only keeps it when it differs from the master's. And diagnosticCode
// and source feed the resolution and are stored nowhere in this table: the code lives in
// diagnosticTerm, which is where SPEC F15 put it.
//
// Three deliberate absences. sortOrder is not here because it is immutable and assigned by
// TRG_investigationDiagnostic_setSortOrder — keeping it out of the type is the cheapest guarantee
// that no service ever sends it. diagnosticTermId is not here because the client does not choose
// it: the resolution returns it, and admitting it would open the second door SPEC F16 §6 closed.
// And diagnosticRaw is not here because it is derived — the service computes it by comparing what
// the investigator wrote against what the master says.
//
// investigationId names the investigation itself, with no UNIQUE behind it: N diagnoses hang from
// one investigation. Unlike investigationPregnancyCondition, the column name says the truth.
//
// diagnosticDate travels as the YYYY-MM-DD string DATEONLY returns, and both it and
// diagnosticTypeItemId are nullable: the current form captures neither, and they are declared
// because adding columns later costs more than leaving them in place.
//
// The update uses Partial<CreateInvestigationDiagnosticInput>: no
// UpdateInvestigationDiagnosticInput exists
export interface CreateInvestigationDiagnosticInput {
    investigationId: string;
    diagnosticName: string;
    diagnosticCode?: string | null;
    source?: TermSource | null;
    diagnosticDate?: string | null;
    diagnosticTypeItemId?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
