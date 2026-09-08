import { TermSource } from '../../constants/enums.constants';

// Three input keys are not columns, and that is the direct consequence of resolving against the
// clinical master. historyName is the text the notifier wrote: no column carries that name — it
// feeds historyRaw, which only keeps it when it differs from the master's. And historyCode and
// source feed the resolution and are stored nowhere in this table: the code lives in
// diagnosticTerm, which is where SPEC F15 put it.
//
// Three deliberate absences. sortOrder is not here because it is immutable and assigned by
// TRG_notificationMedicalHistory_setSortOrder — keeping it out of the type is the cheapest
// guarantee that no service ever sends it. diagnosticTermId is not here because the client does not
// choose it: the resolution returns it, and admitting it would open the second door SPEC F16 §6
// closed. And historyRaw is not here because it is derived — the service computes it by comparing
// what the notifier wrote against what the master says.
//
// notificationId is here and is immutable: the create needs it and the update ignores it in
// silence, since an antecedent is never moved between notifications.
//
// The update uses Partial<CreateNotificationMedicalHistoryInput>: no
// UpdateNotificationMedicalHistoryInput exists
export interface CreateNotificationMedicalHistoryInput {
    notificationId: string;
    historyName: string;
    historyCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
