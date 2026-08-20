import { TermSource } from '../../constants/enums.constants';

// Three input keys are not columns, and that is the direct consequence of resolving against the
// clinical master. complicationName is the text the notifier wrote: no column carries that name —
// it feeds complicationRawName, which only keeps it when it differs from the master's. And
// complicationCode and source feed the resolution and are stored nowhere in this table: the code
// lives in diagnosticTerm, which is where SPEC F15 put it.
//
// Four deliberate absences. sortOrder is not here because it is immutable and assigned by
// TRG_notificationPregnancyComplication_setSortOrder — keeping it out of the type is the cheapest
// guarantee that no service ever sends it. diagnosticTermId is not here because the client does not
// choose it: the resolution returns it, and admitting it would open the second door SPEC F16 §6
// closed. complicationRawName is not here because it is derived — the service computes it by
// comparing what the notifier wrote against what the master says. And metadata is out of scope.
//
// The update uses Partial<CreateNotificationPregnancyComplicationInput>: no
// UpdateNotificationPregnancyComplicationInput exists
export interface CreateNotificationPregnancyComplicationInput {
    pregnancyId: string;
    complicationTypeItemId: string;
    complicationName: string;
    complicationCode?: string | null;
    source?: TermSource | null;
    notes?: string | null;
    isActive?: boolean;
}
