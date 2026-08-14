import { TermSource } from '../../constants/enums.constants';

// source is the only input field that is not a column: it governs which branch of the resolution
// against the clinical master is taken and is discarded afterwards. Its values are the ones of the
// termSource ENUM, taken from the shared constants file and never redeclared here.
//
// Three deliberate absences. sortOrder is not here because it is immutable and assigned by
// TRG_notificationEvent_setSortOrder — keeping it out of the type is the cheapest guarantee that
// no service ever sends it. diagnosticTermId is not here because the client does not choose it:
// the resolution returns it, and admitting it would open a second door to point at a term without
// going through esaviCode. esaviRawName is not here because it is derived — the service computes
// it by comparing what the notifier wrote against what the master says.
//
// The update uses Partial<CreateNotificationEventInput>: no UpdateNotificationEventInput exists
export interface CreateNotificationEventInput {
    notificationId: string;
    esaviName: string;
    esaviCode?: string | null;
    source?: TermSource;
    isMainEsavi?: boolean;
    startDate?: string | null;
    startTime?: string | null;
    isOtherEsavi?: boolean;
    otherDescription?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
