// Rate limit parameters — DEUDA-046.
//
// The subject being limited is the ACCOUNT, not the network location: an entire health facility
// leaves through a single public IP, so counting by IP makes its users block each other. The
// quota by IP is not removed, it is reserved for whoever has not identified themselves yet —
// login and password recovery are exactly the traffic that still has to be braked.
//
// Everything here is read from the environment with a working default, so a deployment can tune
// the ceiling without a release. They do NOT live in `systemConfig`: the limiter runs on every
// request, ahead of `tokenValidation`, and a database read per request to know how many requests
// are allowed would cost more than the requests it denies.

const readPositiveInt = ( value: string | undefined, fallback: number ): number => {
    const parsed = Number( value );
    return Number.isInteger( parsed ) && parsed > 0 ? parsed : fallback;
}

// The window all limiters share. One window keeps the mental model simple: whatever the quota, it
// refills after the same amount of time
export const RATE_LIMIT_WINDOW_MS = readPositiveInt( process.env.RATE_LIMIT_WINDOW_MINUTES, 15 ) * 60 * 1000;

// Quota of an authenticated account. A SPA screen that loads its catalogues in parallel spends ten
// or twenty requests in a second, so the ceiling is set for that: it stops a runaway loop, it does
// not stop normal navigation
export const RATE_LIMIT_AUTHENTICATED_MAX = readPositiveInt( process.env.RATE_LIMIT_AUTHENTICATED_MAX, 1000 );

// Quota of anonymous traffic, counted by IP. Short on purpose: the only endpoints reachable without
// a token are login, refresh and password recovery
export const RATE_LIMIT_ANONYMOUS_MAX = readPositiveInt( process.env.RATE_LIMIT_ANONYMOUS_MAX, 100 );

// ESAVI-AUTH-006, per email address. See `rateLimit.middleware.ts` for why the key is the email
// and not the IP here
export const RATE_LIMIT_PASSWORD_RESET_MAX = readPositiveInt( process.env.RATE_LIMIT_PASSWORD_RESET_MAX, 5 );

// ESAVI-MEDDRA-006. What is protected is not the server, it is a licensed, paid dictionary
export const RATE_LIMIT_MEDDRA_SEARCH_MAX = readPositiveInt( process.env.RATE_LIMIT_MEDDRA_SEARCH_MAX, 60 );

/**
 * Number of proxy hops in front of the API, for `app.set('trust proxy', ...)`.
 *
 * It is a COUNT, never `true`. Trusting every `X-Forwarded-For` lets a client forge the header and
 * choose its own bucket, which is evading the limit by definition; declaring the real number of
 * hops makes Express read the entry the infrastructure actually wrote. The default is 0 — the API
 * exposed directly — so a deployment behind nginx or Cloud Run has to declare its own value.
 */
export const TRUST_PROXY_HOPS = ( () => {
    const parsed = Number( process.env.TRUST_PROXY_HOPS );
    return Number.isInteger( parsed ) && parsed >= 0 ? parsed : 0;
} )();
