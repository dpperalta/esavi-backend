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

export interface DashboardEpiWeek {
    label: string; epiYear: number; epiWeek: number; weekStart: string;
    partial: boolean; serious: number; nonSerious: number; unclassified: number; total: number;
}

export interface DashboardEpiCurve {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    weeks: DashboardEpiWeek[];
}

export interface DashboardVaccineRow { key: string; label: string | null; coded: boolean; cases: number; serious: number; }

export interface DashboardGeoRow {
    geoLocationId: string | null; kind: 'unit' | 'self' | 'unlocated';
    name: string | null; latitude: number | null; longitude: number | null; total: number; serious: number;
}

export interface DashboardDistributions {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    vaccines: { items: DashboardVaccineRow[]; others: { cases: number; serious: number }; casesWithoutSuspectedVaccine: number };
    sexAge: { bands: string[]; sexes: string[]; matrix: number[][] };
    geography: { rows: DashboardGeoRow[] };
    programmatic: {
        investigatedCases: number;
        withoutAdministrationRecord: number;
        withoutColdChainRecord: number;
        administrationErrors: Record<'prescriptionError' | 'contaminatedVaccine' | 'abnormalVaccineConditions' | 'preparationError' | 'handlingError' | 'improperAdministration' | 'anyError', number>;
        coldChainFailures: Record<'rangeDeviation' | 'procedureNotFollowed' | 'vaccineNotUsable' | 'diluentNotUsable' | 'partiallyReconstitutedVaccine' | 'otherObjectPresent' | 'anyFailure', number>;
    };
}

export interface DashboardAgeBand { code: string; minYears: number | null; maxYears: number | null; }

export type DashboardBatchAlertReason = 'MIN_CASES' | 'MIN_SERIOUS' | 'DEATH';

export interface DashboardBatchAlert {
    vaccineKey: string; label: string | null; coded: boolean;
    batchNumber: string; variants: string[];
    cases: number; suspectedCases: number; serious: number; deaths: number; expiredAtVaccination: number;
    firstReportDate: string; lastReportDate: string;
    facilities: number; geoUnits: number; expirationDates: string[];
    reasons: DashboardBatchAlertReason[];
}

export interface DashboardBatchAlerts {
    period: DashboardPeriod;
    scope: { restricted: boolean; hasAssignments: boolean; geoLocationId: string | null };
    thresholds: { minCases: number | null; minSerious: number | null };
    total: number; batchesEvaluated: number; casesWithoutBatch: number;
    alerts: DashboardBatchAlert[];
}

export type DashboardActivityAction =
    'CASE_CREATED' | 'CASE_UPDATED' | 'CASE_DEACTIVATED' | 'CASE_ACTIVATED' |
    'WORKFLOW_DEACTIVATED' | 'WORKFLOW_ACTIVATED' | 'STAGE_STARTED' | 'STAGE_COMPLETED' |
    'CASE_CLOSED' | 'CASE_REOPENED' | 'VALIDATION_REQUESTED' | 'VALIDATION_RESOLVED' | 'OTHER';

export interface DashboardActivityEvent {
    caseId: string; caseCode: string; occurredAt: string;
    method: string; action: DashboardActivityAction; author: string | null;
}

export interface DashboardMyCase {
    caseId: string; caseCode: string; statusCode: string;
    lastActionAt: string; lastAction: DashboardActivityAction;
}

export interface DashboardRecentActivity {
    windowDays: number;
    scope: { restricted: boolean; hasAssignments: boolean };
    territory: DashboardActivityEvent[];
    myCases: DashboardMyCase[];
}

export interface DashboardSystemActivity {
    generatedAt: string;
    activeSessions: number;
    activeUsers24h: number; activeUsers7d: number;
    sessionsStarted24h: number; sessionsStarted7d: number;
    revocations7d: { reason: string; count: number }[];
}
