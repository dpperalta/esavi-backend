import { body, param, query } from 'express-validator';

// This validator only checks shapes. None of the five business rules of the entity lives here:
// the case guard, the one-to-one guard, the three catalog foreign keys, the prohibition of block D
// and the precedence rule all depend on the database or on the stored row, and the validator sees
// neither. They live in finalClassification.service.ts, over the resulting state
export const finalClassificationIdValidator = [
    param('id').notEmpty().withMessage('Final Classification ID is required')
        .isUUID().withMessage('Final Classification ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-FINCLASS-006, which reads by the foreign key and not by the primary one
export const finalClassificationCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The single filter of 002A and 002B. There is deliberately no filter by any domain field
export const finalClassificationListValidator = [
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

export const createFinalClassificationValidator = [
    body('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    body('importanceAItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance A Item ID must be a valid UUID').trim(),
    body('importanceBItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance B Item ID must be a valid UUID').trim(),
    body('importanceCItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance C Item ID must be a valid UUID').trim(),
    body('aIsRelatedToVaccineProduct').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Vaccine Product must be a boolean').toBoolean(),
    body('aIsRelatedToQualityDeviation').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Quality Deviation must be a boolean').toBoolean(),
    body('aIsRelatedToProgrammaticError').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Programmatic Error must be a boolean').toBoolean(),
    body('aIsRelatedToStress').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Stress must be a boolean').toBoolean(),
    body('bIsConsistentTemporalRelation').optional({ nullable: true }).isBoolean()
        .withMessage('B Is Consistent Temporal Relation must be a boolean').toBoolean(),
    body('bHasDeterminantFactor').optional({ nullable: true }).isBoolean()
        .withMessage('B Has Determinant Factor must be a boolean').toBoolean(),
    body('cHasCoincidentCause').optional({ nullable: true }).isBoolean()
        .withMessage('C Has Coincident Cause must be a boolean').toBoolean(),
    body('dIsUnclassifiable').optional({ nullable: true }).isBoolean()
        .withMessage('D Is Unclassifiable must be a boolean').toBoolean(),
    // Deliberately without a length check: notes is text in the DDL, with no declared ceiling.
    // Inventing a limit here would produce a 400 that the database does not back
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// `caseId` is not declared here on purpose: the service ignores it, so answering 400 for a field
// the client may be resending whole from a previous GET is hostile for no reason
export const updateFinalClassificationValidator = [
    body('importanceAItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance A Item ID must be a valid UUID').trim(),
    body('importanceBItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance B Item ID must be a valid UUID').trim(),
    body('importanceCItemId').optional({ nullable: true })
        .isUUID().withMessage('Importance C Item ID must be a valid UUID').trim(),
    body('aIsRelatedToVaccineProduct').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Vaccine Product must be a boolean').toBoolean(),
    body('aIsRelatedToQualityDeviation').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Quality Deviation must be a boolean').toBoolean(),
    body('aIsRelatedToProgrammaticError').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Programmatic Error must be a boolean').toBoolean(),
    body('aIsRelatedToStress').optional({ nullable: true }).isBoolean()
        .withMessage('A Is Related To Stress must be a boolean').toBoolean(),
    body('bIsConsistentTemporalRelation').optional({ nullable: true }).isBoolean()
        .withMessage('B Is Consistent Temporal Relation must be a boolean').toBoolean(),
    body('bHasDeterminantFactor').optional({ nullable: true }).isBoolean()
        .withMessage('B Has Determinant Factor must be a boolean').toBoolean(),
    body('cHasCoincidentCause').optional({ nullable: true }).isBoolean()
        .withMessage('C Has Coincident Cause must be a boolean').toBoolean(),
    body('dIsUnclassifiable').optional({ nullable: true }).isBoolean()
        .withMessage('D Is Unclassifiable must be a boolean').toBoolean(),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
