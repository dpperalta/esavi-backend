import { AnswerOption } from '../../constants/enums.constants';

// notificationId is the only required field, and it is required precisely because it is the
// primary key: the client brings it, the database does not generate it. It is immutable
// afterwards — the update service ignores it even though Partial<CreateSevereNotificationInput>
// lets it through, since changing it is not updating a row but creating another one.
// This is the first CreateEntityInput of the repository without an activity flag: the table
// does not have that column and this entity does not manage its own state.
// The seven remaining fields are optional and explicitly nullable, and that nullability is what
// sustains the tri-state of the five answerOption ones: null and NO_ANSWER are different data
export interface CreateSevereNotificationInput {
    notificationId: string;
    hasPreviousEventHistory?: AnswerOption | null;
    hasAllergyToOtherVaccines?: AnswerOption | null;
    hasAllergyToMedications?: AnswerOption | null;
    hasAllergyToPreviousSameVaccine?: AnswerOption | null;
    hasPregnancyComplications?: AnswerOption | null;
    pregnancyComplicationsDescription?: string | null;
    notes?: string | null;
}
