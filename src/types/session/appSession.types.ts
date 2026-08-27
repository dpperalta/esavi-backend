// Types of the session domain (SPEC F42). The folder is new: neither `src/types/auth/` nor
// `src/types/session/` existed before this spec.
//
// There is deliberately no `UpdateAppSessionInput`. §4 of CONVENTIONS.md forbids it for an entity
// without a `004`, and `appSession` has none: no endpoint of this surface takes row fields in the
// body. The three writes over existing rows — rotate, revoke one, revoke all — are writes with
// their own intent, declared one by one in §3.5 of the spec, and none of them goes through
// `buildDifferentialUpdate`.

/**
 * What ESAVI-SESSION-001 needs to open a session.
 *
 * `ipAddress` and `userAgent` are trace only: they are written at login and never compared on
 * refresh. Both optional — a request may carry neither.
 */
export interface CreateAppSessionInput {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
}

/**
 * Body of ESAVI-AUTH-002 and ESAVI-AUTH-003. The refresh token is the whole credential: neither
 * endpoint carries `tokenValidation`, because the access token is normally expired by the time
 * they are needed.
 */
export interface RefreshTokenInput {
    refreshToken: string;
}

/**
 * What ESAVI-SESSION-001 and ESAVI-AUTH-002 hand back. `refreshToken` is the composite
 * `<sessionId>.<secret>` and this is the only moment it exists in clear text — the row stores
 * `sha256(secret)` and nothing else.
 */
export interface SessionTokenPair {
    token: string;           // access token JWT
    refreshToken: string;    // `<sessionId>.<secreto>`
    expiresAt: Date;         // vencimiento del refresh token
}

/**
 * Role as the login returns it. It is not `UserRole` from `src/types/user/`: that one carries
 * `level`, which the login response has never included.
 */
export interface LoginUserRole {
    roleId: string;
    name: string;
    code: string;
}

/**
 * Response of ESAVI-AUTH-001. Additive change: `token` and the `user` block are what the endpoint
 * already returned, `refreshToken` and `expiresAt` are what SPEC F42 adds.
 */
export interface LoginOutput {
    token: string;
    refreshToken: string;
    expiresAt: Date;
    user: {
        userId: string;
        email: string;
        displayName: string;
        roles: LoginUserRole[];
    };
}
