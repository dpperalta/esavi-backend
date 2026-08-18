// The ten input keys are the ten writable columns: unlike notificationEvent, which needed source
// to choose a resolution branch, there is no master behind medicationCode and therefore nothing to
// discard before the create. The interface is flat and no field is derived.
//
// One deliberate absence. sortOrder is not here because it is immutable and assigned by
// TRG_notificationMedication_setSortOrder — keeping it out of the type is the cheapest guarantee
// that no service ever sends it.
//
// The update uses Partial<CreateNotificationMedicationInput>: no UpdateNotificationMedicationInput
// exists
export interface CreateNotificationMedicationInput {
    notificationId: string;
    medicationName: string;
    medicationCode?: string | null;
    dose?: string | null;
    pharmaceuticalFormItemId?: string | null;
    administrationRouteItemId?: string | null;
    startDate?: string | null;
    isOtherMedication?: boolean;
    otherMedicationText?: string | null;
    isActive?: boolean;
}
