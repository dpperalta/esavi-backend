import { body, param, query } from 'express-validator';

// :id is the vaccineAdministeredId, and this is the difference with the five one to one satellites
// of investigation: the row has an identifier of its own, so :id is not the investigationId.
// The param of 003, 004, 005A, 005B and 005C
export const investigationVaccineAdministeredIdValidator = [
    param('id').notEmpty().withMessage('Administered Vaccine ID is required')
        .isUUID().withMessage('Administered Vaccine ID must be a valid UUID')
        .trim()
];

// The param of the two listings by parent, ESAVI-INVVACAD-002A and 002B. It is the investigationId,
// not an administered vaccine id, so it carries its own message
export const investigationVaccineAdministeredInvestigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVVACAD-006, which walks case -> investigation -> administered vaccines
export const investigationVaccineAdministeredCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// Pagination and nothing else: the three listings return every administered vaccine of their
// investigation, ordered by sortOrder, and no filter by vaccineWhodrugId, doseNumber or text over
// notes is in scope
export const investigationVaccineAdministeredListValidator = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// Three columns of the table are declared in no validator of this file. sortOrder is assigned by
// TRG_investigationVaccineAdministered_setSortOrder and ignored in silence — answering 400 for a
// field a client may be resending whole from a GET is hostile, and the type does not carry it
// anyway. vaccineAdministeredId is minted by the database and isActive is governed by 005A and 005B.
//
// vaccineWhodrugId is required here and only here. In the 001 the validator can resolve it, because
// the body is the complete state: the key is missing, the datum is missing. In the 004 it cannot,
// because "absent" means "do not touch it" and only the service knows what is stored — so the
// update validator below admits the null and the service rejects it over the resulting state.
//
// doseNumber replicates the CHECK of the DDL with its floor of 0, and adds the ceiling of 32767 that
// the smallint type imposes and the CHECK does not: without it a 40000 would surface from the
// driver as a 500 instead of from the validator as a 400.
//
// Neither the resulting requiredness of vaccineWhodrugId nor the uniqueness of the triple is here:
// both depend on the stored state and not only on the body, so they live in the service
export const createInvestigationVaccineAdministeredValidator = [
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    body('vaccineWhodrugId').notEmpty().withMessage('Vaccine WHODrug ID is required')
        .isUUID().withMessage('Vaccine WHODrug ID must be a valid UUID').trim(),
    body('doseNumber').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Dose Number must be an integer between 0 and 32767'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is not declared here on purpose: it is immutable and the service ignores it, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason. The same goes for sortOrder.
//
// vaccineWhodrugId is nullable *here* and rejected in the service: the 400 arrives either way, but
// through the layer that can tell an absent key from an explicit null
export const updateInvestigationVaccineAdministeredValidator = [
    body('vaccineWhodrugId').optional({ nullable: true })
        .isUUID().withMessage('Vaccine WHODrug ID must be a valid UUID').trim(),
    body('doseNumber').optional({ nullable: true })
        .isInt({ min: 0, max: 32767 })
        .withMessage('Dose Number must be an integer between 0 and 32767'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
