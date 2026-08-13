import { AnswerOption } from '../../constants/enums.constants';

// notificationId is the only required field, and it is required precisely because it is the
// primary key: the client brings it, the database does not generate it. It is immutable
// afterwards — the update service ignores it even though Partial<CreateNonSevereNotificationInput>
// lets it through, since changing it is not updating a row but creating another one.
// Like its severe sibling, this input declares no activity flag: the table does not have that
// column and this entity does not manage its own state.
// The twelve remaining fields are optional and explicitly nullable, and that nullability sustains
// two things at once: the tri-state of the six answerOption ones — null and NO_ANSWER are
// different data — and the ability to dissociate a foreign key by sending it as null
export interface CreateNonSevereNotificationInput {
    notificationId: string;
    vaccinationHealthFacilityId?: string | null;
    vaccinationSiteItemId?: string | null;
    vaccinationCenterAddress?: string | null;
    vaccinationGeoLocationId?: string | null;
    verifiedPhysicalDocument?: AnswerOption | null;
    verifiedElectronicRecord?: AnswerOption | null;
    verifiedVerbalReport?: AnswerOption | null;
    verifiedClinicalRecord?: AnswerOption | null;
    verifiedUnknown?: AnswerOption | null;
    verifiedOtherSource?: AnswerOption | null;
    otherSourceDescription?: string | null;
    notes?: string | null;
}
