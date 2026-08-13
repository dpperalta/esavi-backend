// notificationId is the only required field, and it is required precisely because it is the
// primary key: the client brings it, the database does not generate it. It is immutable
// afterwards — the update service ignores it even though Partial<CreateNonSevereNotificationInput>
// lets it through, since changing it is not updating a row but creating another one.
// Like its severe sibling, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state.
// The twelve remaining fields are optional and explicitly nullable, and that nullability sustains
// two things at once: the tri-state of the six boolean ones — null and false are different data,
// "not collected" against a deliberate "no" — and the ability to dissociate a foreign key by
// sending it as null
export interface CreateNonSevereNotificationInput {
    notificationId: string;
    vaccinationHealthFacilityId?: string | null;
    vaccinationSiteItemId?: string | null;
    vaccinationCenterAddress?: string | null;
    vaccinationGeoLocationId?: string | null;
    verifiedPhysicalDocument?: boolean | null;
    verifiedElectronicRecord?: boolean | null;
    verifiedVerbalReport?: boolean | null;
    verifiedClinicalRecord?: boolean | null;
    verifiedUnknown?: boolean | null;
    verifiedOtherSource?: boolean | null;
    otherSourceDescription?: string | null;
    notes?: string | null;
}
