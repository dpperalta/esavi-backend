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

export interface DashboardPeriod { from: string; to: string; days: number; }

export interface DashboardPeriodQuery { from?: string; to?: string; geoLocationId?: string; }

export interface DashboardComparable { current: number; previous: number; }

export type DashboardSeverityCriterion = 'death' | 'disability' | 'congenitalAnomaly' | 'fetalDeath' | 'lifeThreatening' | 'hospitalization' | 'abortion' | 'otherCondition';

export type DashboardNotificationTypeKey = 'SEVERE' | 'NON_SEVERE' | 'none';

export type DashboardCausalityCategory = 'A' | 'B' | 'C' | 'D' | 'UNCLASSIFIED';

export type DashboardASubcategory = 'vaccineProduct' | 'qualityDeviation' | 'programmaticError' | 'stress';

export interface DashboardIndicators {
    period: DashboardPeriod;
    previousPeriod: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    volume: {
        total: DashboardComparable;
        byNotificationType: Record<DashboardNotificationTypeKey, DashboardComparable>;
    };
    severity: {
        classified: DashboardComparable;
        serious: DashboardComparable;
        unclassified: DashboardComparable;
        criteria: Record<DashboardSeverityCriterion, number>;
    };
    deaths: { total: DashboardComparable; autopsyRequested: number; autopsyPerformed: number };
    timeliness: { withEventDate: number; withoutEventDate: number; medianDays: number | null; onTime: number | null; deadlineDays: number | null };
    closure: { closedCases: number; medianDaysToClose: number | null; stageMedianDays: Record<CaseWorkflowStage, number | null> };
    causality: {
        withFinalClassification: number;
        withoutFinalClassification: number;
        categories: Record<DashboardCausalityCategory, number>;
        aSubcategories: Record<DashboardASubcategory, number>;
    };
}

export interface EpiWeek { epiYear: number; epiWeek: number; label: string; weekStart: string; }
