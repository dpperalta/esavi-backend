import { NotificationType } from '../../constants/notification.constants';
import { AnswerOption } from '../../constants/enums.constants';

// caseId and notificationType are required on create and immutable afterwards: the update
// service ignores both even though Partial<CreateNotificationInput> lets them through.
// requestInvestigation is the only optional boolean without `| null`: it is never stored null,
// mirroring the DEFAULT false of the DDL. The other two admit null explicitly, which is what
// sustains their tri-state, and so do the two answerOption fields
export interface CreateNotificationInput {
    caseId: string;
    notificationType: NotificationType;
    esaviDescription: string;
    hasRelevantMedicalHistory?: AnswerOption | null;
    takesMedication?: AnswerOption | null;
    outcomeItemId?: string | null;
    requestInvestigation?: boolean;
    deathDate?: string | null;
    autopsyRequested?: boolean | null;
    verbalAutopsyPerformed?: boolean | null;
    notes?: string | null;
    isActive?: boolean;
}

// The four query filters of 002A and 002B, accumulated with AND and all by equality. Filtering
// by a foreign key that does not exist is an empty search, not a missing resource: it answers
// 200 with count 0
export interface NotificationListFilters {
    caseId?: string;
    notificationType?: NotificationType;
    requestInvestigation?: boolean;
    outcomeItemId?: string;
}
