import { body } from 'express-validator';

/**
 * Validators of SPEC F43 §3.4.
 *
 * THERE IS NO `passwordResetIdValidator`, and that is a declared deviation from §4 of
 * CONVENTIONS.md, which requires the three validators per entity. That rule presupposes an
 * entity with a CRUD surface, and `appPasswordReset` has no route with `:id` — it has no HTTP
 * surface at all. Writing an id validator nobody uses is exactly the dead code the same §4
 * forbids in the paragraph that follows.
 */

// ESAVI-AUTH-006 - Request Password Reset
// The email is the whole body. It is normalized the same way loginValidator normalizes it,
// because the service looks the user up with esaviCrypt(email) exactly as the login does: two
// different normalizations would mean an address that can log in but cannot be found here.
export const forgotPasswordValidator = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail()
];

// ESAVI-AUTH-007 - Reset Password
// The token from the emailed link is the credential, and its shape is verified by the service,
// not here: a malformed token is a 401 with the same message as a token that does not exist,
// and a 400 from this chain would tell the client which of the two it was.
// No row field of `appPasswordReset` is accepted: `usedAt`, `invalidatedAt`, `invalidatedReason`,
// `expiresAt` and `userId` are written by the service, never declared by the client. Neither is
// `requiresPasswordChange`, whose value is fixed by the fact of the write.
export const resetPasswordValidator = [
    body('token')
        .trim()
        .notEmpty().withMessage('Reset token is required')
        .isString().withMessage('Invalid reset token format'),
    body('newPassword')
        .trim()
        .notEmpty().withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
    body('currentPassword').not().exists()
        .withMessage('Current password is not accepted. The reset token is the credential of this operation.'),
    body('userId').not().exists()
        .withMessage('User ID is not accepted. The reset always applies to the owner of the token.'),
    body('requiresPasswordChange').not().exists()
        .withMessage('Requires Password Change is not accepted. It is governed by the system.')
];
