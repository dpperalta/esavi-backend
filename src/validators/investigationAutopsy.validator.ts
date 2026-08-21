import { body, param, query } from 'express-validator';

// The three dates are calendar dates, so they are compared as plain YYYY-MM-DD strings: building a
// Date would drag the server time zone into the comparison and could reject today or admit
// tomorrow depending on the offset. Same criterion as esaviCase, classification, notification,
// patient and investigation, each of which keeps its own copy
const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toIsoDay = (value: unknown): string => String(value).slice(0, 10);

const isNotFutureDate = (value: string): boolean => toIsoDay(value) <= todayIsoDate();

// deathTime is the first `time` column of the repository. Both HH:mm and HH:mm:ss are admitted —
// demanding the seconds would force the client to invent digits no time picker asks for — and the
// service normalizes whatever arrives through toTimeString before comparing it in the diff
const isTimeOfDay = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value));

// :id is the investigationId. This entity has no identifier of its own — the primary key of the
// row is the foreign key to its investigation — so the param is named :id only for uniformity with
// the rest of the routes of the repository. It is also the param of ESAVI-INVAUT-005C
export const investigationAutopsyIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim()
];

// The param of ESAVI-INVAUT-006, which walks case -> investigation -> autopsy
export const investigationAutopsyCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim()
];

// The dual listing inherited from investigationSource: the visibility comes from
// investigation.isActive, so 002A and 002B return different sets. The two filters are accumulative
// with AND and by equality — investigationId over the primary key itself, caseId over the where of
// the investigation include, which travels in the query anyway. There is no boolean filter of its
// own: counting how many investigations ended in an autopsy is an aggregation with its own spec
export const investigationAutopsyListValidator = [
    query('investigationId').optional()
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    query('caseId').optional()
        .isUUID().withMessage('Case ID must be a valid UUID').trim(),
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// The two autopsy flags are plain booleans and not answerOption: the DDL declares them boolean
// (esaviapp.sql:981-982), correcting what SPEC F29 §6 claims. They stay optional and nullable,
// which is what keeps them tri-state — null is "the form did not collect it" and false is a
// deliberate no, and a client must be able to send either one. Neither text carries a maximum
// length: both columns are text in the DDL, with no varchar(n) to replicate.
//
// None of the four coherence rules is checked here: all of them are evaluated over the resulting
// state — on update the stored row merged with the body — which the validator does not see. They
// live in the service and answer 400 too. What does live here is the shape: the two required
// fields, the two temporal rules that need no stored state, and the format of the time
export const createInvestigationAutopsyValidator = [
    // Required and client-supplied: the column has no DEFAULT gen_random_uuid()
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    // Required and strictly true. The DEFAULT true of the DDL is deliberately not replicated here:
    // a silent default would mark a living patient as deceased when the client simply forgot the
    // key, and that is the worst possible error of this entity. isBoolean() is not enough either —
    // false has to be rejected, because a row of autopsy only exists over a death
    body('isDeath').exists().withMessage('Is Death is required')
        .custom((value) => value === true).withMessage('Is Death must be true'),
    // Required by business rule and not by the DDL, and the second field that separates this
    // entity from the satellites that open empty: the row is the record of a fact with a date
    body('deathDate').notEmpty().withMessage('Death Date is required')
        .isISO8601().withMessage('Death Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Death Date cannot be in the future'),
    body('deathTime').optional({ nullable: true })
        .custom(isTimeOfDay).withMessage('Death Time must be a valid time in HH:mm or HH:mm:ss format'),
    body('isAutopsyPerformed').optional({ nullable: true })
        .isBoolean().withMessage('Is Autopsy Performed must be a boolean'),
    body('isAutopsyScheduled').optional({ nullable: true })
        .isBoolean().withMessage('Is Autopsy Scheduled must be a boolean'),
    body('autopsyDate').optional({ nullable: true }).isISO8601()
        .withMessage('Autopsy Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Autopsy Date cannot be in the future'),
    // No temporal restriction at all, and it is the only date of the table without one: an autopsy
    // scheduled and never performed is a real state of the domain, and it may also predate the
    // death. Demanding a future date would break the historical load, which is the normal way of
    // populating this table
    body('scheduledAutopsyDate').optional({ nullable: true }).isISO8601()
        .withMessage('Scheduled Autopsy Date must be a valid ISO 8601 date'),
    body('autopsyComments').optional({ nullable: true }).isString()
        .withMessage('Autopsy Comments must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId and isDeath are not declared here on purpose: the service ignores both, so
// answering 400 for a field the client may be resending whole from a previous GET is hostile for no
// reason — and a PUT that returns the response of its own GET is the normal use of a form
export const updateInvestigationAutopsyValidator = [
    // Optional but NOT nullable, and it is the only field of the update declared this way. The
    // date is correctable — a mistyped one has to be fixable without purging and recreating the
    // row — but not erasable: emptying it would reopen through the back door what the create
    // forbids, and leave rows claiming a death without saying when. optional() without
    // { nullable: true } is what makes an explicit null reach isISO8601() and fail with 400
    body('deathDate').optional()
        .isISO8601().withMessage('Death Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Death Date cannot be in the future'),
    body('deathTime').optional({ nullable: true })
        .custom(isTimeOfDay).withMessage('Death Time must be a valid time in HH:mm or HH:mm:ss format'),
    body('isAutopsyPerformed').optional({ nullable: true })
        .isBoolean().withMessage('Is Autopsy Performed must be a boolean'),
    body('isAutopsyScheduled').optional({ nullable: true })
        .isBoolean().withMessage('Is Autopsy Scheduled must be a boolean'),
    body('autopsyDate').optional({ nullable: true }).isISO8601()
        .withMessage('Autopsy Date must be a valid ISO 8601 date')
        .custom(isNotFutureDate).withMessage('Autopsy Date cannot be in the future'),
    body('scheduledAutopsyDate').optional({ nullable: true }).isISO8601()
        .withMessage('Scheduled Autopsy Date must be a valid ISO 8601 date'),
    body('autopsyComments').optional({ nullable: true }).isString()
        .withMessage('Autopsy Comments must be a string'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
