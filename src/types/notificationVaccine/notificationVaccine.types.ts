// The twelve input keys are the twelve writable columns: unlike notificationEvent, which needed
// source to choose a resolution branch, there is no implicit resolution against vaccineWhodrug -
// a licensed dictionary is populated by import, not from a form - so there is nothing to discard
// before the create. The interface is flat and no field is derived: whoCode, vaccineCode and
// vaccineName are the client's copy of what was notified and are never filled in from the master.
//
// One deliberate absence. sortOrder is not here because it is immutable and assigned by
// TRG_notificationVaccine_setSortOrder — keeping it out of the type is the cheapest guarantee
// that no service ever sends it.
//
// Every data field is optional, which is faithful to the DDL: the table has no mandatory data
// column. The minimum content guard — at least one of vaccineWhodrugId or vaccineName — lives in
// the service and not here, because on update it is evaluated over the resulting state and
// TypeScript cannot express that condition.
//
// The update uses Partial<CreateNotificationVaccineInput>: no UpdateNotificationVaccineInput
// exists
export interface CreateNotificationVaccineInput {
    notificationId: string;
    vaccineWhodrugId?: string | null;
    isSuspected?: boolean;
    whoCode?: string | null;
    vaccineCode?: string | null;
    vaccineName?: string | null;
    vaccinationDate?: string | null;
    vaccinationTime?: string | null;
    doseNumber?: number | null;
    batchNumber?: string | null;
    expirationDate?: string | null;
    notes?: string | null;
    isActive?: boolean;
}
