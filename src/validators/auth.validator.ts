import { body } from 'express-validator';

export const loginValidator = [
    body('email')
        .trim()
        .notEmpty().withMessage('Email is required')
        .isEmail().withMessage('Invalid email format')
        .normalizeEmail(),
    body('password')
        .trim()
        .notEmpty().withMessage('Password is required')
];

// ESAVI-AUTH-002 - Refresh, ESAVI-AUTH-003 - Logout
// The body carries the credential and nothing else. No row field of `appSession` is accepted
// here: `expiresAt`, `revokedAt`, `revokedReason`, `startedAt`, `userId` and `refreshTokenHash`
// are written by the service, never declared by the client.
// Both endpoints take the same body — one credential — so they share one validator rather
// than keeping two identical lists that drift apart.
export const refreshTokenValidator = [
    body('refreshToken')
        .trim()
        .notEmpty().withMessage('Refresh token is required')
        .isString().withMessage('Invalid refresh token format')
];
