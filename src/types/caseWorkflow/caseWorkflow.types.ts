// The four stages of the case file, in process order. It is an application type and not a
// PostgreSQL ENUM: it only travels in the body of 007 and is never stored in any column, so
// there is no reason to carry it into the schema
export type CaseWorkflowStage =
    | 'CLASSIFICATION'
    | 'NOTIFICATION'
    | 'INVESTIGATION'
    | 'FINAL_CLASSIFICATION';

// One field, because the system decides the rest: the initial status is always OPEN and
// `openedAt` is the instant of the creation. Neither is accepted from the client
export interface CreateCaseWorkflowInput {
    caseId: string;
}

export interface CompleteCaseWorkflowStageInput {
    stage: CaseWorkflowStage;
}

export interface CaseWorkflowListFilters {
    caseId?: string;
    statusCode?: string;     // `code` of the catalogItem, not its UUID
    openedFrom?: string;     // ISO date
    openedTo?: string;
}

export interface CaseWorkflowStageDuration {
    startedAt: string | null;
    endedAt: string | null;
    durationMinutes: number | null;   // computed on read; null when a stamp is missing
}

// No update input type is declared for this entity. It is forbidden by §4 of the conventions,
// and there would be nothing to put in it: the entity has no 004 because no field of
// caseWorkflow is written by a human — the stamps are set by 012 and 007, the status is moved
// by the transitions, `reopenCount` is a counter and `openedAt` is fixed by the system
