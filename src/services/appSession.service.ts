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
import { REFRESH_TOKEN_EXPIRES_IN_MS } from '../constants/session.constants';

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

export {
    createAppSessionService
}
