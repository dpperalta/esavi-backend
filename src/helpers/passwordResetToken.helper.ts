import {
    composeRefreshToken,
    generateRefreshSecret,
    hashRefreshSecret,
    parseRefreshToken,
    refreshSecretMatches
} from './refreshToken.helper';

/**
 * Password reset token of SPEC F43 §3.3.
 *
 * The format is the composite `<resetId>.<secret>`, **the very same scheme SPEC F42 §3.3 fixed for
 * the refresh token**, and deliberately so: two opaque credential formats in one repository would
 * be two comparison implementations to keep correct. That is why this file holds no cryptography
 * of its own — it is the domain naming over the primitives of `refreshToken.helper.ts`, so there
 * is exactly one place where a secret is minted, hashed and compared in constant time.
 *
 * What the composite format buys is that resolving a token is a lookup by primary key instead of a
 * scan of the table looking for a hash. `UQ_appPasswordReset_tokenHash` takes no part in that
 * search: it is a net against a collision that, with 32 bytes of entropy, should never happen.
 */

export interface ParsedPasswordResetToken {
    resetId: string;
    secret: string;
}

/**
 * Mints the secret half of a reset token. 32 random bytes in `base64url`, 43 characters.
 */
export const generatePasswordResetSecret = (): string => generateRefreshSecret();

/**
 * SHA-256 of the secret, hexadecimal, 64 characters. This is the only form that reaches the row.
 */
export const hashPasswordResetSecret = ( secret: string ): string => hashRefreshSecret( secret );

/**
 * Joins both halves into the token that travels in the email, once.
 */
export const composePasswordResetToken = ( resetId: string, secret: string ): string =>
    composeRefreshToken( resetId, secret );

/**
 * Splits a received token, validating its shape.
 *
 * Returns `null` instead of throwing: a malformed token is step 1 of §3.5 — an ordinary 401 of
 * ESAVI-AUTH-007 that must be answered **without touching the database**, which is also what keeps
 * a bad uuid from reaching Postgres and turning a 401 into a 500.
 */
export const parsePasswordResetToken = ( token: unknown ): ParsedPasswordResetToken | null => {
    const parsed = parseRefreshToken( token );
    if( !parsed ) {
        return null;
    }
    return { resetId: parsed.sessionId, secret: parsed.secret };
}

/**
 * Compares a received secret against the stored hash in constant time.
 */
export const passwordResetSecretMatches = ( secret: string, storedHash: string | null | undefined ): boolean =>
    refreshSecretMatches( secret, storedHash );
