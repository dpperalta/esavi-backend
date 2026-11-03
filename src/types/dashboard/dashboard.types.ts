import { CaseWorkflowStage } from '../caseWorkflow/caseWorkflow.types';

export interface DashboardStatusCount {
    statusCode: string;
    statusName: string;
    sortOrder: number;
    count: number;
}

export interface DashboardStalledCase {
    caseId: string;
    caseCode: string;
    statusCode: string;
    openStage: CaseWorkflowStage | null;
    referenceAt: string;
    daysStalled: number;
}

export interface DashboardPendingInvestigation {
    caseId: string;
    caseCode: string;
    statusCode: string;
    requestedAt: string;
    daysWaiting: number;
}

export interface DashboardPendingWork {
    generatedAt: string;
    scope: { restricted: boolean; hasAssignments: boolean };
    funnel: DashboardStatusCount[];
    openCases: number;
    stalled: { staleDays: number; total: number; items: DashboardStalledCase[] };
    pendingInvestigations: { total: number; items: DashboardPendingInvestigation[] };
    reopened: { total: number };
}
