import crypto from 'crypto';

/**
 * Refresh token of SPEC F42 §3.3.
 *
 * The token is the composite `<sessionId>.<secret>`:
 *
 *   - `sessionId` is the UUID primary key of the `appSession` row, so resolving a token is a
 *     lookup by primary key instead of a scan over every live session of every user.
 *   - `secret` is 32 random bytes in `base64url`, 43 characters. Only its SHA-256 reaches the
 *     database, in `appSession.refreshTokenHash`. The clear text exists exactly twice: in the
 *     response that mints it and in the body of the request that spends it. It is never stored,
 *     never logged and never returned in an error.
 *
 * SHA-256 and not bcrypt, as §6 of the spec decides: bcrypt is slow on purpose to protect
 * low-entropy passwords, and 256 random bits do not need that. A plain digest also keeps the
 * comparison a single constant-time buffer compare.
 */

// 32 bytes -> 43 base64url characters, no padding.
const SECRET_BYTES = 32;
const SECRET_LENGTH = 43;
const SECRET_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${ SECRET_LENGTH }}$`);

// The sessionId half must be a UUID before it reaches Sequelize: Postgres raises a type error on a
// malformed uuid literal, which would turn a bad token into a 500 instead of the 401 §3.5 requires.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEPARATOR = '.';

export interface ParsedRefreshToken {
    sessionId: string;
    secret: string;
}

/**
 * Mints the secret half of a refresh token.
 */
export const generateRefreshSecret = (): string =>
    crypto.randomBytes( SECRET_BYTES ).toString( 'base64url' );

/**
 * SHA-256 of the secret, hexadecimal, 64 characters. This is the only form that reaches the row.
 */
export const hashRefreshSecret = ( secret: string ): string =>
    crypto.createHash( 'sha256' ).update( secret ).digest( 'hex' );

/**
 * Joins both halves into the token the client receives.
 */
export const composeRefreshToken = ( sessionId: string, secret: string ): string =>
    `${ sessionId }${ SEPARATOR }${ secret }`;

/**
 * Splits a received token, validating its shape.
 *
 * Returns `null` instead of throwing: a malformed token is an ordinary 401 of
 * ESAVI-AUTH-002, not an exception, and the caller must be able to answer it without touching
 * the database. `sessionId` is lowercased so the value handed to Sequelize matches how Postgres
 * renders the uuid.
 */
export const parseRefreshToken = ( token: unknown ): ParsedRefreshToken | null => {
    if ( typeof token !== 'string' ) {
        return null;
    }

    // indexOf and not split: a secret can never contain the separator, so anything with a second
    // dot is malformed and must not be silently truncated into a valid-looking pair.
    const separatorIndex = token.indexOf( SEPARATOR );
    if ( separatorIndex === -1 ) {
        return null;
    }

    const sessionId = token.slice( 0, separatorIndex );
    const secret = token.slice( separatorIndex + 1 );

    if ( !UUID_PATTERN.test( sessionId ) || !SECRET_PATTERN.test( secret ) ) {
        return null;
    }

    return { sessionId: sessionId.toLowerCase(), secret };
};

/**
 * Compares a received secret against the stored hash in constant time.
 *
 * A null or malformed `storedHash` answers `false`: a row whose hash was never written cannot
 * match anything. `timingSafeEqual` needs both buffers to be the same length, which the length
 * guard above it guarantees — calling it with mismatched lengths throws.
 */
export const refreshSecretMatches = ( secret: string, storedHash: string | null | undefined ): boolean => {
    if ( typeof storedHash !== 'string' ) {
        return false;
    }

    const candidate = Buffer.from( hashRefreshSecret( secret ), 'hex' );
    const stored = Buffer.from( storedHash, 'hex' );

    if ( candidate.length !== stored.length || stored.length === 0 ) {
        return false;
    }

    return crypto.timingSafeEqual( candidate, stored );
};
