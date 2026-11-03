import { CaseWorkflowStage } from '../types';

// Code of the catalogType that groups the eight workflow states. Seeded by esaviapp.sql with
// upsertCatalogItem; if it is missing the deployment is broken, not the request
export const CASE_WORKFLOW_STATUS_CATALOG_CODE = 'caseWorkflowStatus';

// The eight states of the file, by their catalogItem code
export const CASE_WORKFLOW_STATUS = {
    OPEN: 'OPEN',
    IN_CLASSIFICATION: 'IN_CLASSIFICATION',
    IN_NOTIFICATION: 'IN_NOTIFICATION',
    IN_INVESTIGATION: 'IN_INVESTIGATION',
    IN_FINAL_CLASSIFICATION: 'IN_FINAL_CLASSIFICATION',
    PENDING_VALIDATION: 'PENDING_VALIDATION',
    CLOSED: 'CLOSED',
    REOPENED: 'REOPENED'
} as const;

// The four stages in process order. The index is what "the previous stage" means when 012 seals
// the end of the one before the stage that is starting
export const CASE_WORKFLOW_STAGES: CaseWorkflowStage[] = [
    'CLASSIFICATION',
    'NOTIFICATION',
    'INVESTIGATION',
    'FINAL_CLASSIFICATION'
];

// The column prefix of each stage. The eight stamps are `<prefix>StartedAt` and `<prefix>EndedAt`,
// so one map replaces eight branches — and adding a stage means adding one entry, not eight
export const CASE_WORKFLOW_STAGE_FIELD: Record<CaseWorkflowStage, string> = {
    CLASSIFICATION: 'classification',
    NOTIFICATION: 'notification',
    INVESTIGATION: 'investigation',
    FINAL_CLASSIFICATION: 'finalClassification'
};
