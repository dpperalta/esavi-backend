import { NextFunction, Request, RequestHandler, Response } from 'express';
import rateLimit from 'express-rate-limit';

/**
 * Per-route rate limiters (SPEC F43 §3.4).
 *
 * The global limiter of `src/app.ts` allows 100 requests per IP every 15 minutes, which for a
 * public endpoint that sends emails is an amplifier rather than a brake. This file holds the
 * stricter limits that some routes need on their own.
 *
 * A limiter goes FIRST in the middleware chain, before the validators: one that runs after
 * validation has already paid the cost it exists to avoid.
 */

// Not mounted under test, for the reason `src/app.ts:71-72` documents for the global one: a suite
// issues many requests from a single IP in one run, and the limiter would turn its last
// assertions into 429s. The pass-through keeps the route composition identical in every
// environment, so nothing about the chain changes depending on where it runs
const passThrough: RequestHandler = ( _req: Request, _res: Response, next: NextFunction ): void => next();

/**
 * ESAVI-AUTH-006 — `POST /api/auth/forgot-password`.
 *
 * Five requests per IP every 15 minutes. It protects the 006 only: ESAVI-AUTH-007 demands a valid
 * token, and limiting it would punish the legitimate user who mistypes the link they pasted.
 *
 * It does not close the timing-enumeration risk §7 declares open — it only makes the statistical
 * sampling that attack needs expensive.
 */
export const passwordResetLimiter: RequestHandler = process.env.NODE_ENV === 'test'
    ? passThrough
    : rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // Five reset requests per IP per window
        message: 'Too many password reset requests from this IP, please try again later.'
    });
