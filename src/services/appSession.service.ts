import { Transaction } from 'sequelize';

import { AppSession } from '../models';
import { AppError, esaviLog, getMessage } from '../helpers';
import { jwtGenerate } from '../helpers/jwt.helper';
import {
    composeRefreshToken,
    generateRefreshSecret,
    hashRefreshSecret
} from '../helpers/refreshToken.helper';
import { AppDetails, CreateAppSessionInput, SessionTokenPair } from '../types';
import { REFRESH_TOKEN_EXPIRES_IN_MS, SessionRevokeReason } from '../constants/session.constants';

/**
 * appSession persistence (SPEC F42 §3.4).
 *
 * The three operations of this file have **no controller and no route**: they are the persistence
 * domain that `auth` and `user` call into, following the precedent of ESAVI-DIAGTERM-006. Giving
 * `appSession` an HTTP surface is a CRUD with its seven artefacts and its own role matrix, and the
 * spec leaves it out on purpose.
 *
 * `006` and `007` take non-canonical numbers because revoking is none of the seven operations of
 * the `001`-`005B` range, and `appSession` has no `isActive` with which to express `005A`/`005B`.
 *
 * Nothing here goes through `buildDifferentialUpdate`, and §3.5 of the spec states why for each
 * write: a create never does, and revoking is a write with its own intent — it records a fact and
 * its reason, the same way an activation does.
 */

// ESAVI-SESSION-001 - Create App Session Service
/**
 * Opens a session and mints the pair of credentials that go with it.
 *
 * The secret half of the refresh token is returned **once**: this call is the only moment it
 * exists in clear text. The row keeps `sha256(secret)` and nothing else, so a dump of `appSession`
 * hands over no usable credential.
 *
 * `startedAt` is left to the database default. It anchors the absolute ceiling of §3.5 and is
 * never written again by any operation of this spec.
 *
 * `transaction` is optional because the caller decides the unit of work: ESAVI-AUTH-001 opens a
 * session on its own, while a caller that already holds a transaction passes it in.
 */
const createAppSessionService = async (
    data: CreateAppSessionInput,
    lang: string,
    transaction?: Transaction
): Promise<SessionTokenPair> => {
    const { userId, ipAddress, userAgent } = data;
    try {
        const secret = generateRefreshSecret();
        const expiresAt = new Date( Date.now() + REFRESH_TOKEN_EXPIRES_IN_MS );

        // Audit entry: the session belongs to the user who just proved their identity, so the
        // actor of the entry is that same user
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId,
            method: 'ESAVI-SESSION-001',
            detail: 'Session opened by login'
        };

        const session = await AppSession.create({
            userId,
            refreshTokenHash: hashRefreshSecret( secret ),
            ipAddress: ipAddress ?? null,
            userAgent: userAgent ?? null,
            expiresAt,
            appDetails: [ newEntry ]
        }, { transaction });

        const token = await jwtGenerate({ userId }) as string;

        // composeRefreshToken is the last time the secret is handled. It is deliberately absent
        // from every log line below and from the AppError thrown on failure
        return {
            token,
            refreshToken: composeRefreshToken( session.sessionId, secret ),
            expiresAt
        };
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-SESSION-001 - Error creating session for user ${ userId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.loginFailed', lang), 500, 'SESSION_001_CREATE_FAILED', error);
    }
}

// The two revocations below share their whole body except the filter, so it lives here once.
// Rows are fetched and updated one by one instead of with a bulk UPDATE because every row keeps
// its own appDetails history, and `[...current, entry]` cannot be expressed as a single SET.
// The volume justifies it: a user has a handful of live sessions, not thousands.
const revokeSessions = async (
    where: { sessionId: string } | { userId: string },
    reason: SessionRevokeReason,
    method: string,
    transaction?: Transaction
): Promise<number> => {
    // `revokedAt IS NULL` is what makes a second revocation a no-op: an already revoked row is
    // outside the filter, so its original timestamp and its original reason are preserved.
    // `deletedAt IS NULL` keeps a soft-deleted row out of the count
    const sessions = await AppSession.findAll({
        where: { ...where, revokedAt: null, deletedAt: null },
        transaction
    });

    const revokedAt = new Date();

    for ( const session of sessions ) {
        const currentAppDetails = Array.isArray( session.appDetails ) ? session.appDetails : [];
        const newEntry: AppDetails = {
            createdAt: revokedAt,
            user: session.userId,
            method,
            detail: `Session revoked (${ reason })`
        };
        await session.update({
            revokedAt,
            revokedReason: reason,
            updatedAt: revokedAt,
            appDetails: [ ...currentAppDetails, newEntry ]
        }, { transaction });
    }

    return sessions.length;
}

// ESAVI-SESSION-006 - Revoke App Session Service
/**
 * Revokes one session, by primary key.
 *
 * Returns the number of rows affected — 1 the first time, 0 from then on — instead of throwing on
 * a session that is already closed. ESAVI-AUTH-003 is idempotent and needs that distinction to
 * stay a fact it may report, never an error: closing something already closed met its goal.
 */
const revokeAppSessionService = async (
    sessionId: string,
    reason: SessionRevokeReason,
    lang: string,
    transaction?: Transaction
): Promise<number> => {
    try {
        return await revokeSessions({ sessionId }, reason, 'ESAVI-SESSION-006', transaction);
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-SESSION-006 - Error revoking session ${ sessionId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.logoutFailed', lang), 500, 'SESSION_006_REVOKE_FAILED', error);
    }
}

// ESAVI-SESSION-007 - Revoke All User Sessions Service
/**
 * Revokes every live session of one user: logout-all, a detected refresh token reuse, and a
 * password change all land here.
 *
 * The filter leans on IX_appSession_active — ("userId", "expiresAt") WHERE "revokedAt" IS NULL
 * AND "deletedAt" IS NULL — which is the partial index the DDL has been carrying since the start
 * for exactly this query.
 */
const revokeAllUserSessionsService = async (
    userId: string,
    reason: SessionRevokeReason,
    lang: string,
    transaction?: Transaction
): Promise<number> => {
    try {
        return await revokeSessions({ userId }, reason, 'ESAVI-SESSION-007', transaction);
    } catch ( error ) {
        esaviLog(`[ERROR]: ESAVI-SESSION-007 - Error revoking sessions for user ${ userId }: ${ error }`, 'error');
        if ( error instanceof AppError ) {
            throw error;
        }
        throw new AppError(getMessage('auth.logoutAllFailed', lang), 500, 'SESSION_007_REVOKE_ALL_FAILED', error);
    }
}

export {
    createAppSessionService,
    revokeAppSessionService,
    revokeAllUserSessionsService
}
