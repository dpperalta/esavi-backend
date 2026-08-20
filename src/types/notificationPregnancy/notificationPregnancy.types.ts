import { AnswerOption } from '../../constants/enums.constants';

// The seven input keys are the seven writable columns. Nothing is resolved against another table and
// nothing is derived, so the interface is flat and there is nothing to discard before the create.
// hasComplications in particular is client data: deriving it from notificationPregnancyComplication
// is a decision left to the spec of that table, which is the one that will have rows to count.
//
// wasPregnantAtVaccination is the only data field declared without ?, and it is what makes this
// interface different from the six satellites before it. A pregnancy row that does not say whether
// there was a pregnancy reports nothing, so ESAVI-NOTIFPRG-001 demands the answer — any of the five
// enum values, because demanding YES would turn the table into a register of confirmed pregnancies
// and lose the case that matters most: vaccinating someone whose pregnancy was unknown.
//
// The asymmetry with the update is deliberate. Partial<> makes the field optional and nullable in
// ESAVI-NOTIFPRG-004: the create guarantees the row is born informed, and the update exists to
// correct, so a notifier who answered by mistake can withdraw the answer without losing the
// pregnancyId and its whole audit trail.
//
// The update uses Partial<CreateNotificationPregnancyInput>: no dedicated update interface exists,
// as §4 of the conventions forbids
export interface CreateNotificationPregnancyInput {
    notificationId: string;
    wasPregnantAtVaccination: AnswerOption;
    wasPregnantAtEsavi?: AnswerOption | null;
    lastMenstruationDate?: string | null;
    probableDeliveryDate?: string | null;
    hasComplications?: AnswerOption | null;
    notes?: string | null;
    isActive?: boolean;
}
