import bcrypt from 'bcrypt';
import net from 'net';

import { AppUser } from '../models/appUser.model';
import { AppRole } from '../models/appRole.model';

import { AppSession } from '../models/appSession.model';

import { getMessage } from '../helpers/i18n.helper';
import { esaviCrypt, esaviDecrypt } from '../helpers/crypto.helper';
import { AppError } from '../helpers/appError.helper';
import { esaviLog } from '../helpers/esaviLogs.helper';
import { jwtGenerate } from '../helpers/jwt.helper';
import {
    composeRefreshToken,
    generateRefreshSecret,
    hashRefreshSecret,
    parseRefreshToken,
    refreshSecretMatches
} from '../helpers/refreshToken.helper';
import {
    createAppSessionService,
    revokeAllUserSessionsService,
    revokeAppSessionService
} from './appSession.service';
import {
    createPasswordResetService,
    invalidateUserPasswordResetsService
} from './appPasswordReset.service';
import { sendMailService } from './common/mail.service';
import { renderEmailTemplate } from '../helpers/mailer.helper';
import { getAppConfigString } from '../helpers/appConfig.helper';
import { sequelize } from '../database/connection';
import { AppDetails, LoginOutput, SessionTokenPair } from '../types';
import { PASSWORD_RESET_SCOPE, PASSWORD_RESET_URL_CODE } from '../constants/passwordReset.constants';
import { REFRESH_ABSOLUTE_MAX_IN_MS, REFRESH_TOKEN_EXPIRES_IN_MS } from '../constants/session.constants';

interface LoginInput {
    email: string;
    password: string;
}

/**
 * Where the request came from. Trace only: SPEC F42 §2 leaves both fields out of the refresh
 * checks, because a User-Agent changes with every browser update and an IP changes when the
 * device hops networks. Validating them would close legitimate sessions daily in exchange for a
 * barrier an attacker holding the token copies for free.
 */
interface LoginRequestMeta {
    ipAddress?: string | null;
    userAgent?: string | null;
}

// `userAgent` is text in the DDL, so the cap is ours: a header is client-controlled and unbounded
const USER_AGENT_MAX_LENGTH = 512;

// The column is `inet`, and Postgres rejects anything that is not an address — which would turn a
// trace field into a failed login. Anything unparseable is dropped instead of written
const toInetOrNull = ( value?: string | null ): string | null =>
    ( typeof value === 'string' && net.isIP( value ) !== 0 ) ? value : null;

const toUserAgentOrNull = ( value?: string | null ): string | null =>
    typeof value === 'string' && value.length > 0 ? value.slice( 0, USER_AGENT_MAX_LENGTH ) : null;

// ESAVI-AUTH-001 - Login Service
// Everything up to the password check is what this service has always done. What SPEC F42 adds is
// the tail: the login now opens a row in `appSession` and hands back a refresh token next to the
// access token. The change is additive — no field of the previous response disappears or changes type
const loginService = async({ email, password }: LoginInput, lang: string, meta: LoginRequestMeta = {}): Promise<LoginOutput> => {
    // Normalized exactly like the creation does. citext does not help here: the column stores
    // the ciphertext, so Postgres case insensitivity applies to the encrypted text and not to
    // the address. Without this, a login typed in uppercase produces a different ciphertext
    const normalizedEmail = email.trim().toLowerCase();
    const user = await AppUser.findOne({
        where: {
            email: esaviCrypt(normalizedEmail),
            isActive: true
        },
        include: [
            {
                model: AppRole,
                as: 'roles',
                through: { attributes: [] }
            }
        ]
    });
    if( !user ) {
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if( !isPasswordValid ) {
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const roles = user.roles?.map((role: AppRole) => ({
        roleId: role.getDataValue('roleId'),
        name: role.getDataValue('name'),
        code: role.getDataValue('code')
    })) ?? [];

    // ESAVI-SESSION-001 mints both credentials at once: it is the only place the refresh token
    // exists in clear text, and it also signs the access token so the JWT is issued in one place
    const { token, refreshToken, expiresAt } = await createAppSessionService({
        userId: user.getDataValue('userId'),
        ipAddress: toInetOrNull( meta.ipAddress ),
        userAgent: toUserAgentOrNull( meta.userAgent )
    }, lang);

    return {
        token,
        refreshToken,
        expiresAt,
        user: {
            userId: user.userId,
            email: esaviDecrypt(user.email),
            displayName: esaviDecrypt(user.displayName),
            roles
        }
    };  
};

/**
 * Steps 1 to 3 of SPEC F42 3.5, shared by ESAVI-AUTH-002 and ESAVI-AUTH-003 because both resolve
 * the row the same way — and because reuse detection must fire identically on either endpoint.
 *
 * Returns the row together with whether the secret matched, instead of deciding for the caller:
 * a mismatch on an already revoked session is a 401 for the refresh and a plain 200 for the
 * logout, and that difference belongs to each operation, not here.
 *
 * `operation` only spells the AppError code. The message keys are the same for both: a client
 * must not be able to tell a malformed token from a `sessionId` that does not exist.
 */
const resolveRefreshTokenSession = async (
    refreshToken: string,
    lang: string,
    operation: 'AUTH_002' | 'AUTH_003'
): Promise<{ session: AppSession; secretMatches: boolean }> => {
    // 1. Shape. A malformed token never reaches the database
    const parsed = parseRefreshToken( refreshToken );
    if ( !parsed ) {
        throw new AppError(getMessage('auth.invalidRefreshToken', lang), 401, `${ operation }_INVALID_REFRESH_TOKEN`);
    }

    // 2. The row, by primary key
    const session = await AppSession.findOne({
        where: { sessionId: parsed.sessionId, deletedAt: null }
    });
    if ( !session ) {
        throw new AppError(getMessage('auth.invalidRefreshToken', lang), 401, `${ operation }_INVALID_REFRESH_TOKEN`);
    }

    // 3. The secret, in constant time. A mismatch on a session that was still live is reuse: the
    // row already holds a newer hash, so the token being spent was rotated away by an earlier
    // call. `revokedAt IS NULL` is what live means here, and it matters — without it an attacker
    // holding a stale token of an already closed session could revoke the rest at will
    const secretMatches = refreshSecretMatches( parsed.secret, session.refreshTokenHash );
    if ( !secretMatches && session.revokedAt === null ) {
        await revokeAllUserSessionsService( session.userId, 'REUSE_DETECTED', lang );
        esaviLog(`ESAVI-${ operation.replace('_', '-') } - Refresh token reuse detected on session ${ session.sessionId }; every session of user ${ session.userId } revoked`, 'warn');
        throw new AppError(getMessage('auth.refreshTokenReused', lang), 401, `${ operation }_REFRESH_TOKEN_REUSED`);
    }

    return { session, secretMatches };
}

// ESAVI-AUTH-002 - Refresh Token Service
/**
 * Renews the pair of credentials from a refresh token, rotating it.
 *
 * The order of the seven checks below is the rule, not an implementation detail (SPEC F42 3.5),
 * and two of them carry a decision worth naming:
 *
 *   - A malformed token and a `sessionId` that does not exist answer with the **same code and the
 *     same message**. Telling them apart turns the endpoint into an oracle for which sessions
 *     exist.
 *   - A secret that does not match a live session is **reuse**: the row already holds a newer
 *     hash, so the token being spent was rotated away by an earlier call. Both the attacker and
 *     the victim are logged out, because there is no way to tell which of the two is calling.
 *
 * Nothing here goes through `buildDifferentialUpdate`, and 3.5 says why: rotation is a write with
 * its own intent, recording that this refresh token was spent. The hash always changes by
 * construction, and `expiresAt` moves even if the computed value matched the stored one.
 */
const refreshTokenService = async ( refreshToken: string, lang: string ): Promise<SessionTokenPair> => {
    try {
        // Steps 1 to 3: shape, row and secret, with reuse detection
        const { session, secretMatches } = await resolveRefreshTokenSession( refreshToken, lang, 'AUTH_002' );

        // 4. Revoked
        if ( session.revokedAt !== null ) {
            throw new AppError(getMessage('auth.sessionRevoked', lang), 401, 'AUTH_002_SESSION_REVOKED');
        }

        // A revoked session with a wrong secret leaves step 3 through step 4. Anything still
        // holding a mismatch here is a live session whose hash was never written
        if ( !secretMatches ) {
            throw new AppError(getMessage('auth.invalidRefreshToken', lang), 401, 'AUTH_002_INVALID_REFRESH_TOKEN');
        }

        const now = new Date();

        // 5. Expired
        if ( !session.expiresAt || new Date( session.expiresAt ).getTime() <= now.getTime() ) {
            throw new AppError(getMessage('auth.sessionExpired', lang), 401, 'AUTH_002_SESSION_EXPIRED');
        }

        // 6. Absolute ceiling. It lives in the application, not in the DDL: there is no
        // `absoluteExpiresAt` column, the ceiling is `startedAt` plus the configured span. A
        // session that crossed it is revoked here and now, even with its `expiresAt` still ahead
        const absoluteDeadline = new Date( session.startedAt ).getTime() + REFRESH_ABSOLUTE_MAX_IN_MS;
        if ( absoluteDeadline <= now.getTime() ) {
            await revokeAppSessionService( session.sessionId, 'ABSOLUTE_MAX_REACHED', lang );
            throw new AppError(getMessage('auth.sessionExpired', lang), 401, 'AUTH_002_SESSION_EXPIRED');
        }

        // 7. The owner must still exist and be active. Same code as steps 1 and 2: a client
        // renewing a session of a disabled account learns nothing about why it failed
        const user = await AppUser.findOne({
            where: { userId: session.userId, isActive: true },
            attributes: ['userId']
        });
        if ( !user ) {
            throw new AppError(getMessage('auth.invalidRefreshToken', lang), 401, 'AUTH_002_INVALID_REFRESH_TOKEN');
        }

        // Rotation. The new secret replaces the spent one and `expiresAt` slides forward without
        // ever crossing the ceiling. `startedAt` is not touched: it anchors that ceiling, and a
        // session whose anchor moved on every renewal would never expire
        const secret = generateRefreshSecret();
        const expiresAt = new Date( Math.min( now.getTime() + REFRESH_TOKEN_EXPIRES_IN_MS, absoluteDeadline ) );

        const currentAppDetails = Array.isArray( session.appDetails ) ? session.appDetails : [];
        const newEntry: AppDetails = {
            createdAt: now,
            user: session.userId,
            method: 'ESAVI-AUTH-002',
            detail: 'Refresh token rotated'
        };

        await session.update({
            refreshTokenHash: hashRefreshSecret( secret ),
            expiresAt,
            updatedAt: now,
            appDetails: [ ...currentAppDetails, newEntry ]
        });

        const token = await jwtGenerate({ userId: session.userId }) as string;

        return {
            token,
            refreshToken: composeRefreshToken( session.sessionId, secret ),
            expiresAt
        };
    } catch ( error ) {
        if ( error instanceof AppError ) {
            throw error;
        }
        // The refresh token is deliberately absent from this line: it is a live credential
        esaviLog('ESAVI-AUTH-002 - Error refreshing session: ' + error, 'error');
        throw new AppError(getMessage('auth.refreshFailed', lang), 500, 'AUTH_002_REFRESH_FAILED', error);
    }
}

// ESAVI-AUTH-003 - Logout Service
/**
 * Closes the session the refresh token belongs to.
 *
 * **Idempotent**: a session that was already revoked, or already expired, answers 200 as well.
 * Closing something already closed met its goal, and a logout is not an operation that should
 * fail — that is the whole difference with ESAVI-AUTH-002, which answers 401 on the same row.
 *
 * Reuse detection still fires from step 3: a token whose hash does not match a live session
 * revokes every session of that user, on this endpoint exactly as on the refresh.
 *
 * The write itself is delegated to ESAVI-SESSION-006, which returns how many rows it revoked —
 * 1 the first time, 0 from then on. Neither number reaches the client: SPEC F42 3.7 makes this
 * a state operation, and 10 of the conventions says a state operation returns no `data`.
 */
const logoutService = async ( refreshToken: string, lang: string ): Promise<void> => {
    try {
        // Steps 1 to 3, the same resolution the refresh does
        const { session, secretMatches } = await resolveRefreshTokenSession( refreshToken, lang, 'AUTH_003' );

        // A mismatch that survived step 3 belongs to an already revoked session: there is nothing
        // left to close, and reporting it as an error would break the idempotence
        if ( !secretMatches ) {
            return;
        }

        await revokeAppSessionService( session.sessionId, 'LOGOUT', lang );
    } catch ( error ) {
        if ( error instanceof AppError ) {
            throw error;
        }
        // The refresh token is deliberately absent from this line: it is a live credential
        esaviLog('ESAVI-AUTH-003 - Error during logout: ' + error, 'error');
        throw new AppError(getMessage('auth.logoutFailed', lang), 500, 'AUTH_003_LOGOUT_FAILED', error);
    }
}

// ESAVI-AUTH-004 - Logout All Service
/**
 * Closes every live session of one user.
 *
 * `userId` reaches this service from `req.user`, never from a body. Accepting it from the client
 * would turn the endpoint into a denial of service against any user of the installation, which is
 * exactly why this is the only operation of the mechanism that carries `tokenValidation`.
 *
 * Idempotent: with no live sessions it returns 0 rather than failing. The count is returned
 * because the client needs to know how many devices it just closed.
 */
const logoutAllService = async ( userId: string, lang: string ): Promise<{ revokedCount: number }> => {
    try {
        const revokedCount = await revokeAllUserSessionsService( userId, 'LOGOUT_ALL', lang );
        return { revokedCount };
    } catch ( error ) {
        if ( error instanceof AppError ) {
            throw error;
        }
        esaviLog('ESAVI-AUTH-004 - Error during logout all: ' + error, 'error');
        throw new AppError(getMessage('auth.logoutAllFailed', lang), 500, 'AUTH_004_LOGOUT_ALL_FAILED', error);
    }
}

// ESAVI-AUTH-006 - Forgot Password Service
/**
 * Opens a password reset request and emails the link that consumes it.
 *
 * THE OPERATION RETURNS NOTHING AND FAILS AT NOTHING THE CLIENT CAN SEE. Whether the account
 * exists, whether it is active, whether SMTP answered — none of it changes the response, because
 * any difference turns this endpoint into an inventory of the health personnel of the
 * installation. §3.5 spells the three halves of that decision:
 *
 *   - No user: the operation ends, having written nothing and sent nothing. The address is NOT
 *     logged either — a log line naming it is the same inventory by another door.
 *   - A user: invalidating the previous requests and opening the new one share ONE transaction.
 *     Leaving the old ones alive because the new one failed is exactly the state the rule "only
 *     the last link works" exists to prevent.
 *   - The email goes out AFTER the commit, never inside the transaction. A send inside a
 *     transaction that later rolls back leaves a link in the inbox with no row behind it — a
 *     token that does not exist. Write, commit, send.
 *
 * A failed delivery is an `error` log line and still a 200. The timing difference between the two
 * paths is the enumeration risk §7 declares open and does not close.
 */
const forgotPasswordService = async ( email: string, lang: string, meta: LoginRequestMeta = {} ): Promise<void> => {
    // Normalized exactly like the login does, and for the same reason: the column holds the
    // ciphertext, so an address typed in uppercase produces a different one
    const normalizedEmail = email.trim().toLowerCase();

    const user = await AppUser.findOne({
        where: {
            email: esaviCrypt( normalizedEmail ),
            isActive: true
        }
    });

    if ( !user ) {
        // No personal data: not the address, not a hash of it, not its domain
        esaviLog('ESAVI-AUTH-006 - Password reset requested for an address with no active account', 'info');
        return;
    }

    const userId = user.getDataValue('userId');

    // The transaction opens here and not at the top: everything above is a read
    const transaction = await sequelize.transaction();
    let resetToken;
    try {
        // ESAVI-PWDRESET-007 first: only the last link sent may work
        await invalidateUserPasswordResetsService( userId, 'SUPERSEDED', lang, transaction );
        resetToken = await createPasswordResetService({
            userId,
            requestedIp: toInetOrNull( meta.ipAddress ),
            requestedUserAgent: toUserAgentOrNull( meta.userAgent )
        }, lang, transaction );
        await transaction.commit();
    } catch ( error ) {
        await transaction.rollback();
        esaviLog('ESAVI-AUTH-006 - Error opening the password reset request: ' + error, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.forgotPasswordFailed', lang), 500, 'AUTH_006_FORGOT_PASSWORD_FAILED', error);
    }

    // Everything below is outside the transaction and outside the client's view: a delivery that
    // fails is logged and the answer stays 200
    try {
        const resetUrl = await getAppConfigString( PASSWORD_RESET_URL_CODE, PASSWORD_RESET_SCOPE, lang );
        const expiresInMinutes = Math.max(
            1,
            Math.round( ( resetToken.expiresAt.getTime() - Date.now() ) / 60000 )
        );

        // The language is req.lang: `appUser` has no preferred-language column, so whoever asks
        // from an English browser gets an English email even if they use the app in Spanish
        const rendered = renderEmailTemplate('passwordReset', lang, {
            displayName: esaviDecrypt( user.getDataValue('displayName') ),
            resetUrl: `${ resetUrl }?token=${ resetToken.token }`,
            expiresInMinutes: `${ expiresInMinutes }`
        });

        await sendMailService({
            to: normalizedEmail,
            subject: getMessage('auth.passwordResetEmailSubject', lang),
            html: rendered.html,
            text: rendered.text
        }, lang );
    } catch ( error ) {
        // The link is deliberately absent from this line: it is a live credential, and §3.3
        // keeps it out of every log in every environment
        esaviLog(`ESAVI-AUTH-006 - Error sending the password reset email for user ${ userId }: ${ error }`, 'error');
    }
}

export {
    loginService,
    refreshTokenService,
    logoutService,
    logoutAllService,
    forgotPasswordService
}