// Types of the auth domain (SPEC F43). The folder is new: `src/types/session/` was opened by
// SPEC F42 and this one opens `src/types/auth/`.
//
// There is deliberately no `UpdateAppPasswordResetInput`. §4 of CONVENTIONS.md forbids it for an
// entity without a `004`, and `appPasswordReset` has none — it has no HTTP surface at all. The
// writes over existing rows — marking `usedAt`, marking `invalidatedAt` — are writes with their
// own intent, declared one by one in §3.5 of the spec, and none of them goes through
// `buildDifferentialUpdate`.

/**
 * What ESAVI-PWDRESET-001 needs to open a reset request.
 *
 * `requestedIp` and `requestedUserAgent` are trace only: they are written when the link is asked
 * for and never compared when the token is consumed. Both optional — a request may carry neither.
 */
export interface CreatePasswordResetInput {
    userId: string;
    requestedIp?: string | null;
    requestedUserAgent?: string | null;
}

/**
 * Body of ESAVI-AUTH-006. The email is the whole input: the endpoint carries no `tokenValidation`,
 * because whoever calls it cannot authenticate — that is the problem it solves.
 */
export interface ForgotPasswordInput {
    email: string;
}

/**
 * Body of ESAVI-AUTH-007. The token from the emailed link is the credential, and the service
 * verifies it against `appPasswordReset`.
 */
export interface ResetPasswordInput {
    token: string;
    newPassword: string;
}

/**
 * What ESAVI-PWDRESET-001 hands back. `token` is the composite `<resetId>.<secret>` and this is
 * the only moment it exists in clear text — the row stores `sha256(secret)` and nothing else. It
 * never reaches a log, `appDetails` or an HTTP response.
 */
export interface PasswordResetToken {
    token: string;       // `<resetId>.<secreto>`, en claro y una sola vez
    expiresAt: Date;
}
