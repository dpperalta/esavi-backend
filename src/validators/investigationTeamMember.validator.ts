import { body, param, query } from 'express-validator';

// Pagination, shared by the three listings — 002A, 002B and 006. It is spread into the two param
// validators below instead of being exported as a list validator of its own, because none of the
// three listings admits a single filter: every one of them returns the whole team of its parent,
// ordered by sortOrder
const paginationRules = [
    query('limit').optional().isInt({ min: 1, max: 100 })
        .withMessage('Limit must be an integer between 1 and 100'),
    query('offset').optional().isInt({ min: 0 })
        .withMessage('Offset must be a non-negative integer')
];

// :id is the investigationTeamMemberId, and this is the difference with investigationSource and
// investigationAutopsy: the row has an identifier of its own, so :id is not the investigationId.
// The param of 003, 004, 005A, 005B and 005C
export const investigationTeamMemberIdValidator = [
    param('id').notEmpty().withMessage('Investigation Team Member ID is required')
        .isUUID().withMessage('Investigation Team Member ID must be a valid UUID')
        .trim()
];

// The param of the two listings by parent, ESAVI-INVTEAM-002A and 002B. It is the investigationId,
// not a team member id, so it carries its own message
export const investigationTeamMemberInvestigationIdValidator = [
    param('id').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID')
        .trim(),
    ...paginationRules
];

// The param of ESAVI-INVTEAM-006, which walks case -> investigation -> team members
export const investigationTeamMemberCaseIdValidator = [
    param('caseId').notEmpty().withMessage('Case ID is required')
        .isUUID().withMessage('Case ID must be a valid UUID')
        .trim(),
    ...paginationRules
];

// Three columns of the table are declared in no validator of this file. sortOrder is assigned by
// TRG_investigationTeamMember_setSortOrder and ignored in silence — answering 400 for a field a
// client may be resending whole from a GET is hostile, and the type does not carry it anyway.
// investigationTeamMemberId is minted by the database. And isActive is governed by 005A and 005B,
// never by the create or the update.
//
// The maximum lengths replicate the varchar(n) of the DDL so an overlong text fails here, with a
// readable 400, and not in Postgres. email carries none: the column is citext, which has no length
export const createInvestigationTeamMemberValidator = [
    body('investigationId').notEmpty().withMessage('Investigation ID is required')
        .isUUID().withMessage('Investigation ID must be a valid UUID').trim(),
    // The only required data field: the single NOT NULL data column of the table
    body('fullName').notEmpty().withMessage('Full Name is required')
        .isString().withMessage('Full Name must be a string').trim()
        .isLength({ max: 250 }).withMessage('Full Name must be at most 250 characters long'),
    body('institutionName').optional({ nullable: true }).trim()
        .isLength({ max: 500 }).withMessage('Institution Name must be at most 500 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address'),
    // Free text and not a phone format: the domain collects extensions, several numbers in one
    // field and international prefixes written in every possible way
    body('phone').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];

// investigationId is not declared here on purpose: the service ignores it, so answering 400 for a
// field the client may be resending whole from a previous GET is hostile for no reason — and a PUT
// that returns the response of its own GET is the normal use of a form
export const updateInvestigationTeamMemberValidator = [
    // Optional but NOT nullable, and it is the only field of the update declared this way. A name
    // is correctable — a misspelled one has to be fixable without recreating the row — but not
    // erasable: the column is NOT NULL, and a member without a name records nothing. optional()
    // without { nullable: true } is what makes an explicit null reach isString() and fail with 400
    body('fullName').optional()
        .isString().withMessage('Full Name must be a string').trim()
        .notEmpty().withMessage('Full Name cannot be empty')
        .isLength({ max: 250 }).withMessage('Full Name must be at most 250 characters long'),
    // The four nullable ones. The explicit null is what lets the client erase a value already
    // stored, and not only change it
    body('institutionName').optional({ nullable: true }).trim()
        .isLength({ max: 500 }).withMessage('Institution Name must be at most 500 characters long'),
    body('email').optional({ nullable: true }).trim()
        .isEmail().withMessage('Email must be a valid email address'),
    body('phone').optional({ nullable: true }).trim()
        .isLength({ max: 50 }).withMessage('Phone must be at most 50 characters long'),
    body('notes').optional({ nullable: true }).isString()
        .withMessage('Notes must be a string')
];
