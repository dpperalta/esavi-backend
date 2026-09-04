import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';

import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';
import {
    RATE_LIMIT_ANONYMOUS_MAX,
    RATE_LIMIT_AUTHENTICATED_MAX,
    RATE_LIMIT_MEDDRA_SEARCH_MAX,
    RATE_LIMIT_PASSWORD_RESET_MAX,
    RATE_LIMIT_WINDOW_MS
} from '../constants/rateLimit.constants';

/**
 * Rate limiters — DEUDA-046.
 *
 * All of them count the **account** when there is one and the **IP** when there is not. That is
 * the point of this file: an entire health facility leaves through a single public IP, so a quota
 * per IP is a quota its users take away from each other. The quota per IP is not removed, it is
 * reserved for whoever has not identified themselves yet — login, refresh and password recovery,
 * which is the traffic that still has to be braked.
 *
 * A limiter goes FIRST in the middleware chain, before the validators and before
 * `tokenValidation`: one that runs after validation has already paid the cost it exists to avoid.
 * Running ahead of `tokenValidation` is also why the key cannot be read from `req.user` — it does
 * not exist yet — and why this file verifies the token on its own.
 */

interface RateLimitTokenPayload {
    user?: {
        userId?: string;
    };
}

type RateLimitSubjectKind = 'user' | 'ip';

interface RateLimitSubject {
    kind: RateLimitSubjectKind;
    key: string;
}

// The subject is resolved once per request and cached on it: the global limiter asks for it twice
// — once for the key, once for the quota — and the per-route limiters ask again on the routes that
// mount one. A symbol keeps the cache out of anything that enumerates the request
const SUBJECT_CACHE = Symbol('esaviRateLimitSubject');

/**
 * Reads `userId` out of the `Authorization` header, or `undefined` when there is no usable token.
 *
 * The signature is **verified**, never merely decoded: a `jwt.decode` would let anyone pick their
 * own bucket by inventing a different `userId` on every request, which is evading the limit by
 * definition. `jwt.verify` is a local signature check with no database access — far cheaper than
 * `tokenValidation`, which re-reads the user and their roles on every request.
 *
 * An expired or forged token is not an error here: it falls through to the IP quota, and the 401
 * is `tokenValidation`'s to raise further down the chain.
 */
const readUserIdFromToken = ( req: Request ): string | undefined => {
    const authHeader = req.headers.authorization;
    if( !authHeader || !authHeader.startsWith('Bearer ') ) {
        return undefined;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if( !jwtSecret ) {
        return undefined;
    }

    try {
        const decoded = jwt.verify( authHeader.slice(7).trim(), jwtSecret ) as RateLimitTokenPayload;
        const userId = decoded?.user?.userId;
        return typeof userId === 'string' && userId.length > 0 ? userId : undefined;
    } catch {
        return undefined;
    }
}

// `ipKeyGenerator` is mandatory for the IP fallback: without it an IPv6 client gets one bucket per
// address and rotates freely inside its own /64, which is a limit that does not limit
const ipKey = ( req: Request ): string => `ip:${ ipKeyGenerator( req.ip ?? '' ) }`;

const resolveSubject = ( req: Request ): RateLimitSubject => {
    const cache = req as Request & { [ SUBJECT_CACHE ]?: RateLimitSubject };
    if( cache[ SUBJECT_CACHE ] ) {
        return cache[ SUBJECT_CACHE ];
    }

    const userId = readUserIdFromToken( req );
    const subject: RateLimitSubject = userId
        ? { kind: 'user', key: `user:${ userId }` }
        : { kind: 'ip', key: ipKey( req ) };

    cache[ SUBJECT_CACHE ] = subject;
    return subject;
}

/**
 * Turns the 429 into the ordinary error envelope.
 *
 * The default handler of `express-rate-limit` answers with the `message` string as-is, outside
 * `errorHandler`: no `{ ok, message, code, errors }` and no i18n, so the client cannot treat it
 * like every other error it receives. Handing an `AppError` to `next()` puts it back on the one
 * error path the API has. This is why `languageMiddleware` is mounted BEFORE the limiter in
 * `src/app.ts`: `req.lang` has to exist for this message to be translated.
 */
const rateLimitHandler = ( messageKey: string, code: string ) =>
    ( req: Request, _res: Response, next: NextFunction ): void => {
        next( new AppError( getMessage( messageKey, req.lang ), 429, code ) );
    }

// Not mounted under test, for the reason `src/app.ts` documents: a suite issues many requests from
// a single IP in one run, and the limiter would turn its last assertions into 429s. The
// pass-through keeps the route composition identical in every environment, so nothing about the
// chain changes depending on where it runs
const passThrough: RequestHandler = ( _req: Request, _res: Response, next: NextFunction ): void => next();

const isTest = (): boolean => process.env.NODE_ENV === 'test';

/**
 * The global limiter, mounted in `src/app.ts` ahead of the routes.
 *
 * One limiter, two quotas: a wide one for the authenticated account — a SPA screen loading its
 * catalogues in parallel spends ten or twenty requests in a second, and the ceiling exists to stop
 * a runaway loop, not normal navigation — and a short one for anonymous traffic, counted by IP.
 */
export const globalLimiter: RequestHandler = isTest()
    ? passThrough
    : rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: ( req: Request ): number => resolveSubject( req ).kind === 'user'
            ? RATE_LIMIT_AUTHENTICATED_MAX
            : RATE_LIMIT_ANONYMOUS_MAX,
        keyGenerator: ( req: Request ): string => resolveSubject( req ).key,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler( 'common.tooManyRequests', 'RATE_LIMIT_EXCEEDED' )
    });

/**
 * ESAVI-AUTH-006 — `POST /api/auth/forgot-password`.
 *
 * Keyed by the **email address**, not by the IP: nobody is authenticated on this route by
 * definition, so an IP key would give one health facility five requests for everyone in it. What
 * this limiter protects against is a mailbox being flooded with reset links, and the address is
 * precisely the subject of that abuse.
 *
 * Rotating the address to get a fresh bucket does not buy an attacker anything: the anonymous
 * quota of `globalLimiter` still counts every one of those requests against their IP, and it is
 * the backstop that caps the total volume.
 *
 * It does not close the timing-enumeration risk SPEC F43 §7 declares open — it only makes the
 * statistical sampling that attack needs expensive.
 */
export const passwordResetLimiter: RequestHandler = isTest()
    ? passThrough
    : rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: RATE_LIMIT_PASSWORD_RESET_MAX,
        // The body is already parsed here — `express.json()` is mounted before the routes — but it
        // has NOT been validated: the limiter runs ahead of `forgotPasswordValidator` on purpose,
        // so anything may arrive in `email`. Only a string is usable as a key, and it is capped at
        // the maximum length of an address so an oversized value cannot bloat the store
        keyGenerator: ( req: Request ): string => {
            const email = ( req.body as { email?: unknown } | undefined )?.email;
            if( typeof email === 'string' && email.trim().length > 0 ) {
                return `pwreset:${ email.trim().toLowerCase().slice(0, 254) }`;
            }
            return `pwreset:${ ipKey( req ) }`;
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler( 'auth.tooManyPasswordResetRequests', 'AUTH_006_RATE_LIMIT_EXCEEDED' )
    });

/**
 * ESAVI-MEDDRA-006 — `GET /api/meddra/search`.
 *
 * Sixty searches per account per window: sixty is the ceiling of an autocomplete used normally,
 * and the result cache of the service absorbs most of them before they ever reach the API. The
 * limit exists because MedDRA is a licensed, paid dictionary — what is being protected here is not
 * the server, it is the licence, and a licence is consumed per account, not per network location.
 */
export const meddraSearchLimiter: RequestHandler = isTest()
    ? passThrough
    : rateLimit({
        windowMs: RATE_LIMIT_WINDOW_MS,
        limit: RATE_LIMIT_MEDDRA_SEARCH_MAX,
        keyGenerator: ( req: Request ): string => `meddra:${ resolveSubject( req ).key }`,
        standardHeaders: true,
        legacyHeaders: false,
        handler: rateLimitHandler( 'meddra.tooManySearchRequests', 'MEDDRA_006_RATE_LIMIT_EXCEEDED' )
    });
