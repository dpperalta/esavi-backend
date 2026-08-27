// Session lifetimes for SPEC F42. Two independent clocks live here:
//
//   REFRESH_TOKEN_EXPIRES_IN   how long a refresh token is worth something. Every renewal pushes
//                              `appSession.expiresAt` this far into the future again — the sliding
//                              part of the session.
//   REFRESH_ABSOLUTE_MAX_IN    the ceiling the sliding window can never cross, counted from
//                              `appSession.startedAt`, which is why that column is never rewritten.
//
// The access token keeps its own clock in JWT_EXPIRES_IN, read by `jwt.helper.ts`; it is a
// different credential with a different lifetime and it is deliberately not resolved here.
//
// Both variables are optional: an installation that does not declare them gets the defaults below
// instead of a startup failure, the same contract `pagination.constants.ts` offers.

export const DEFAULT_REFRESH_TOKEN_EXPIRES_IN = '8h';
export const DEFAULT_REFRESH_ABSOLUTE_MAX_IN = '30d';

// The DDL stores no `absoluteExpiresAt`: the ceiling is derived in the application from
// `startedAt` plus this many milliseconds, so both durations have to reach Node as numbers.
// The accepted grammar is a positive integer followed by a unit — `30s`, `15m`, `8h`, `30d` —
// the same shape `jsonwebtoken` accepts for `expiresIn`, so JWT_EXPIRES_IN and these two read
// alike in a `.env` file. A bare number is read as milliseconds.
const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)?$/;

const UNIT_IN_MS: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
};

/**
 * Turns a duration expression into milliseconds.
 *
 * A malformed or non-positive value falls back to `fallback` instead of throwing: this runs at
 * module load, and a typo in `.env` must not take the process down before it can serve a request.
 */
export const parseDurationToMs = ( value: string | undefined, fallback: string ): number => {
    const candidate = ( value ?? '' ).trim().toLowerCase();
    const match = DURATION_PATTERN.exec( candidate );

    if ( !match ) {
        return parseDurationToMs( fallback, '0' );
    }

    const amount = parseInt( match[1], 10 );
    const unit = match[2] ?? 'ms';

    if ( amount <= 0 ) {
        return parseDurationToMs( fallback, '0' );
    }

    return amount * UNIT_IN_MS[unit];
};

export const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN
    || DEFAULT_REFRESH_TOKEN_EXPIRES_IN;

export const REFRESH_ABSOLUTE_MAX_IN = process.env.REFRESH_ABSOLUTE_MAX_IN
    || DEFAULT_REFRESH_ABSOLUTE_MAX_IN;

export const REFRESH_TOKEN_EXPIRES_IN_MS = parseDurationToMs(
    REFRESH_TOKEN_EXPIRES_IN,
    DEFAULT_REFRESH_TOKEN_EXPIRES_IN
);

export const REFRESH_ABSOLUTE_MAX_IN_MS = parseDurationToMs(
    REFRESH_ABSOLUTE_MAX_IN,
    DEFAULT_REFRESH_ABSOLUTE_MAX_IN
);

// The four reasons `appSession.revokedReason` may hold. The column is free `text` in the DDL, so
// this list is the only thing keeping the values from drifting; §3.5 of SPEC F42 assigns one to
// each writer. ABSOLUTE_MAX_REACHED is not in the spec's §3.1 table but is required by §3.5 step 6.
export const SESSION_REVOKE_REASONS = [
    'LOGOUT',
    'LOGOUT_ALL',
    'REUSE_DETECTED',
    'PASSWORD_CHANGED',
    'ABSOLUTE_MAX_REACHED'
] as const;

export type SessionRevokeReason = ( typeof SESSION_REVOKE_REASONS )[number];
