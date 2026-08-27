import { Transaction } from 'sequelize';

import { AppPasswordReset, AppUser } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { getAppConfigNumber } from '../helpers/appConfig.helper';
import {
    composePasswordResetToken,
    generatePasswordResetSecret,
    hashPasswordResetSecret,
    parsePasswordResetToken,
    passwordResetSecretMatches
} from '../helpers/passwordResetToken.helper';
import { AppDetails, CreatePasswordResetInput, PasswordResetToken } from '../types';
import {
    PASSWORD_RESET_EXPIRES_MINUTES_CODE,
    PASSWORD_RESET_SCOPE,
    PasswordResetInvalidationReason
} from '../constants/passwordReset.constants';

/**
 * appPasswordReset persistence (SPEC F43 §3.4).
 *
 * The three operations of this file have **no controller and no route**: they are the persistence
 * domain that `auth` and `user` call into, following the precedent of ESAVI-DIAGTERM-006 and of
 * `appSession.service.ts`. The table has no HTTP surface at all — no listing, no getById, no 004,
 * no activation.
 *
 * `006` and `007` take non-canonical numbers because resolving and invalidating are none of the
 * seven operations of the `001`-`005B` range, and `appPasswordReset` has no `isActive` with which
 * to express `005A`/`005B`.
 *
 * NO WRITE HERE IS A DIFFERENTIAL UPDATE — the helper of CONVENTIONS.md §11 is deliberately not
 * used, and §3.5 of the spec states why for each
 * write: a create never does, and marking `usedAt` or `invalidatedAt` is a write with its own
 * intent — it records a fact, its instant and its reason, the way an activation does. A second
 * attempt writes nothing because the **filter** excludes the row, not because a diff came out
 * empty.
 *
 * THE TOKEN IN CLEAR TEXT NEVER REACHES THIS FILE'S LOGS. Not in an `esaviLog` line, not in
 * `appDetails`, not in an `AppError`. It exists in memory for as long as the email takes to be
 * composed, in any environment, `NODE_ENV=development` included.
 */

const MINUTE_IN_MS = 60 * 1000;

// A request is "live" while it has been neither consumed nor invalidated nor soft-deleted. It is
// the same predicate as IX_appPasswordReset_pending, written once so the 001, the 006 and the 007
// cannot drift from the partial index they lean on
const LIVE_REQUEST_FILTER = {
    usedAt: null,
    invalidatedAt: null,
    deletedAt: null
};

// ESAVI-PWDRESET-001 - Create Password Reset Service
/**
 * Opens a reset request and mints the token that goes with it.
 *
 * The secret is returned **once**: this call is the only moment it exists in clear text. The row
 * keeps `sha256(secret)` and nothing else, so a dump of `appPasswordReset` hands over no usable
 * credential.
 *
 * `transaction` is optional because the caller decides the unit of work. ESAVI-AUTH-006 always
 * passes one: invalidating the previous requests and opening the new one are a single unit, and
 * leaving the old ones alive because the new one failed is exactly the state the rule "only the
 * last link works" exists to prevent.
 */
const createPasswordResetService = async (
    data: CreatePasswordResetInput,
    lang: string,
    transaction?: Transaction
): Promise<PasswordResetToken> => {
    const { userId, requestedIp, requestedUserAgent } = data;
    try {
        const expiresInMinutes = await getAppConfigNumber(
            PASSWORD_RESET_EXPIRES_MINUTES_CODE,
            PASSWORD_RESET_SCOPE,
            lang
        );

        const secret = generatePasswordResetSecret();
        const expiresAt = new Date( Date.now() + expiresInMinutes * MINUTE_IN_MS );

        // Audit entry: the request belongs to the owner of the mailbox it is sent to, so the actor
        // is that same user — nobody else took this action
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId,
            method: 'ESAVI-PWDRESET-001',
            detail: 'Password reset requested'
        };

        const reset = await AppPasswordReset.create({
            userId,
            tokenHash: hashPasswordResetSecret( secret ),
            expiresAt,
            // Trace only, never compared when the token is consumed. Truncated to what the column
            // takes: a forged 8 KB User-Agent must not turn a reset request into a database error
            requestedIp: requestedIp ? requestedIp.slice( 0, 255 ) : null,
            requestedUserAgent: requestedUserAgent ? requestedUserAgent.slice( 0, 1000 ) : null,
            appDetails: [ newEntry ]
        }, { transaction });

        // composePasswordResetToken is the last time the secret is handled. It is deliberately
        // absent from every log line below and from the AppError thrown on failure
        return {
            token: composePasswordResetToken( reset.resetId, secret ),
            expiresAt
        };
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-PWDRESET-001 - Error creating password reset for user ${ userId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.forgotPasswordFailed', lang), 500, 'PWDRESET_001_CREATE_FAILED', error);
    }
}

// ESAVI-PWDRESET-007 - Invalidate User Password Resets Service
/**
 * Invalidates every live request of one user.
 *
 * Three callers land here: ESAVI-AUTH-006 with `SUPERSEDED` before opening a new one,
 * ESAVI-AUTH-007 with `SUPERSEDED` after writing the password and with `REUSE_DETECTED` when a
 * consumed token is presented again, and ESAVI-USER-006 with `PASSWORD_CHANGED`.
 *
 * Returns the number of rows invalidated. Rows are fetched and updated one by one instead of with
 * a bulk UPDATE because every row keeps its own `appDetails` history, and `[...current, entry]`
 * cannot be expressed as a single SET. The volume justifies it: a user has at most a handful of
 * live requests, never thousands.
 */
const invalidateUserPasswordResetsService = async (
    userId: string,
    reason: PasswordResetInvalidationReason,
    lang: string,
    transaction?: Transaction
): Promise<number> => {
    try {
        // The filter is what makes a second invalidation a no-op: an already closed row is outside
        // it, so its original timestamp and its original reason are preserved. It leans on
        // IX_appPasswordReset_pending
        const resets = await AppPasswordReset.findAll({
            where: { userId, ...LIVE_REQUEST_FILTER },
            transaction
        });

        const invalidatedAt = new Date();

        for ( const reset of resets ) {
            const currentAppDetails = Array.isArray( reset.appDetails ) ? reset.appDetails : [];
            const newEntry: AppDetails = {
                createdAt: invalidatedAt,
                user: userId,
                method: 'ESAVI-PWDRESET-007',
                detail: `Password reset invalidated (${ reason })`
            };
            await reset.update({
                invalidatedAt,
                invalidatedReason: reason,
                updatedAt: invalidatedAt,
                appDetails: [ ...currentAppDetails, newEntry ]
            }, { transaction });
        }

        return resets.length;
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-PWDRESET-007 - Error invalidating password resets for user ${ userId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.resetPasswordFailed', lang), 500, 'PWDRESET_007_INVALIDATE_FAILED', error);
    }
}

export interface ResolvedPasswordReset {
    reset: AppPasswordReset;
    user: AppUser;
}

// ESAVI-PWDRESET-006 - Resolve Password Reset Service
/**
 * Resolves a received token into the row it names and the user it belongs to, or throws.
 *
 * THE ORDER OF THE SEVEN CHECKS IS THE OPERATION, not a way of writing it down (§3.5):
 *
 *   1. Shape of the token          401 AUTH_007_INVALID_RESET_TOKEN, without touching the database
 *   2. Row by `resetId`            401 AUTH_007_INVALID_RESET_TOKEN, same code and same message
 *   3. Hash, in constant time      401 AUTH_007_INVALID_RESET_TOKEN, same code again
 *   4. `usedAt` not null           401 AUTH_007_RESET_TOKEN_USED, after invalidating the live ones
 *   5. `invalidatedAt` not null    401 AUTH_007_RESET_TOKEN_INVALIDATED
 *   6. `expiresAt` in the past     401 AUTH_007_RESET_TOKEN_EXPIRED
 *   7. User still exists, active   401 AUTH_007_INVALID_RESET_TOKEN
 *
 * Steps 1, 2, 3 and 7 share code AND message on purpose: telling them apart would reveal which
 * `resetId` exist, and these accounts are identifiable health personnel. Every rejection is a 401
 * and never a 404, for the same reason.
 *
 * Step 4 is the only one with a side effect. Presenting an already consumed token is the signal
 * that a link which circulated is being replayed, so every live request of that user is closed
 * with `REUSE_DETECTED` before answering — and deliberately **outside** any transaction of the
 * caller, so the defensive write survives the rejection.
 *
 * The controller of ESAVI-AUTH-007 checks none of this again.
 */
const resolvePasswordResetService = async (
    token: string,
    lang: string,
    transaction?: Transaction
): Promise<ResolvedPasswordReset> => {
    try {
        // 1. Shape. A malformed token never reaches Sequelize: a bad uuid literal is a type error
        // in Postgres, which would turn this 401 into a 500
        const parsed = parsePasswordResetToken( token );
        if( !parsed ) {
            throw new AppError(getMessage('auth.invalidResetToken', lang), 401, 'AUTH_007_INVALID_RESET_TOKEN');
        }

        // 2. Row by primary key — the whole point of the composite format
        const reset = await AppPasswordReset.findOne({
            where: { resetId: parsed.resetId, deletedAt: null },
            transaction
        });
        if( !reset ) {
            throw new AppError(getMessage('auth.invalidResetToken', lang), 401, 'AUTH_007_INVALID_RESET_TOKEN');
        }

        // 3. Secret against the stored hash, in constant time
        if( !passwordResetSecretMatches( parsed.secret, reset.tokenHash ) ) {
            throw new AppError(getMessage('auth.invalidResetToken', lang), 401, 'AUTH_007_INVALID_RESET_TOKEN');
        }

        // 4. Replay of a link that already circulated: close everything still live for that user
        if( reset.usedAt ) {
            esaviLog(`[WARN]: ESAVI-PWDRESET-006 - Reuse of a consumed password reset token for user ${ reset.userId }`, 'warn');
            await invalidateUserPasswordResetsService( reset.userId, 'REUSE_DETECTED', lang );
            throw new AppError(getMessage('auth.resetTokenUsed', lang), 401, 'AUTH_007_RESET_TOKEN_USED');
        }

        // 5. Displaced by a later request, or by a deliberate password change. The benign case
        if( reset.invalidatedAt ) {
            throw new AppError(getMessage('auth.resetTokenInvalidated', lang), 401, 'AUTH_007_RESET_TOKEN_INVALIDATED');
        }

        // 6. Expired
        if( reset.expiresAt.getTime() <= Date.now() ) {
            throw new AppError(getMessage('auth.resetTokenExpired', lang), 401, 'AUTH_007_RESET_TOKEN_EXPIRED');
        }

        // 7. The user is revalidated here and not trusted from when the link was minted: between
        // the request and the consumption fit thirty minutes and a deactivation
        const user = await AppUser.findOne({
            // isActive alone, as ESAVI-AUTH-002 does (src/services/auth.service.ts:209): the
            // soft delete of a user always travels with isActive false, and AppUser does not
            // type deletedAt as nullable
            where: { userId: reset.userId, isActive: true },
            transaction
        });
        if( !user ) {
            throw new AppError(getMessage('auth.invalidResetToken', lang), 401, 'AUTH_007_INVALID_RESET_TOKEN');
        }

        return { reset, user };
    } catch ( error ) {
        if ( error instanceof AppError ) {
            throw error;
        }
        // The token is deliberately absent from this line: a log that carries it turns esaviLog
        // into a list of live credentials
        esaviLog(`[ERROR]: ESAVI-PWDRESET-006 - Error resolving password reset token: ${ error }`, 'error');
        throw new AppError(getMessage('auth.resetPasswordFailed', lang), 500, 'PWDRESET_006_RESOLVE_FAILED', error);
    }
}

export {
    createPasswordResetService,
    resolvePasswordResetService,
    invalidateUserPasswordResetsService
}
