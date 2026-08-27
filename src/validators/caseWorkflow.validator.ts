import { body, param, query } from 'express-validator';

// This validator only checks shapes. None of the state rules of the entity lives here — whether
// the file is closed, whether a stage has started, whether the four closing preconditions are met
// all depend on the stored row, and the validator sees none of it. They live in
// caseWorkflow.service.ts

// The :id of the three canonical operations that address the row by its primary key
export const caseWorkflowIdValidator = [
    param('id').notEmpty().withMessage('Case Workflow ID is required')
        .isUUID().withMessage('Case Workflow ID must be a valid UUID')
        .trim()
];

// The :caseId of 006 and of the five transitions. They all hang off /case/:caseId and not off
// /:id: the client running a transition knows the case, not the UUID of its workflow
export const caseWorkflowCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The four filters of 002A and 002B. statusCode travels as the `code` of the catalogItem
// (IN_INVESTIGATION), never as its UUID, so it is validated as a string and resolved against the
// catalog by the service — where an unknown code becomes a 404
export const caseWorkflowListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('statusCode').optional()
        .isString().withMessage('Status code must be a string').trim(),
    query('openedFrom').optional()
        .isISO8601().withMessage('Opened from must be a valid ISO 8601 date').trim(),
    query('openedTo').optional()
        .isISO8601().withMessage('Opened to must be a valid ISO 8601 date').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The single body field of the whole entity: the stage 007 closes. The four values are the ones
// of CaseWorkflowStage, and validateFields answers 400 for anything else
export const completeCaseWorkflowStageValidator = [
    body('stage').notEmpty().withMessage('Stage is required')
        .isIn(['CLASSIFICATION', 'NOTIFICATION', 'INVESTIGATION', 'FINAL_CLASSIFICATION'])
        .withMessage('Stage must be one of CLASSIFICATION, NOTIFICATION, INVESTIGATION or FINAL_CLASSIFICATION')
        .trim()
];
