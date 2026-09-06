// FIRST, and deliberately: this module calls dotenv, and an `import` that came before it would be
// evaluated with an empty environment. `rateLimit.constants.ts` and `pagination.constants.ts` read
// `process.env` at module level, so the order of these two lines is what makes their values arrive
import { env } from './config/env';

import express from 'express';
import cors from 'cors';
import routes from './routes';
import helmet from 'helmet';
import morgan from 'morgan';
import { styleText } from 'node:util';
import { esaviLog } from './helpers/esaviLogs.helper';
import { TRUST_PROXY_HOPS } from './constants/rateLimit.constants';
import { globalLimiter } from './middlewares/rateLimit.middleware';
import { morganMiddleware }  from './middlewares/morgan.middleware';
import { languageMiddleware } from './middlewares/language.middleware';
import { errorHandler } from './middlewares/errorHandler.middleware';

const DEFAULT_CORS_ORIGINS = 'http://localhost:5173,http://localhost:3000';

/**
 * Resolves the CORS whitelist from CORS_ORIGINS. The variable is mandatory in
 * production; in any other environment it falls back to the local frontends.
 */
const resolveCorsOrigins = (): string[] => {
    const rawOrigins = ( process.env.CORS_ORIGINS ?? '' ).trim();

    if( !rawOrigins && env !== 'production' ) {
        return DEFAULT_CORS_ORIGINS.split(',');
    }

    const origins = rawOrigins
        .split(',')
        .map( origin => origin.trim().replace(/\/+$/, '') )
        .filter( origin => origin.length > 0 );

    if( origins.length === 0 ) {
        const message = 'CORS_ORIGINS is required when NODE_ENV=production and must list at least one origin';
        console.error(styleText('red', `Error starting server: ${ message }`));
        esaviLog(`Error starting server: ${ message }`, 'error');
        process.exit(1);
    }

    return origins;
}

const allowedOrigins = resolveCorsOrigins();

const app = express();

// A COUNT of proxy hops, never `true`: `req.ip` is the key of the rate limiter, and trusting every
// `X-Forwarded-For` would let a client forge the header and pick its own bucket. With the default
// 0 — the API exposed directly — Express reads the socket address; a deployment behind nginx or
// Cloud Run declares its real number of hops in TRUST_PROXY_HOPS
app.set('trust proxy', TRUST_PROXY_HOPS);

app.use(helmet());
app.disable('x-powered-by'); // Remove X-Powered-By header for security
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
}));

// Morgan
if( env === 'development' ) {
    app.use(morgan('dev'));
} else {
    app.use(morganMiddleware);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Language middleware. It goes BEFORE the limiter: a 429 travels as an `AppError` through
// `errorHandler` like any other error, and its message needs `req.lang` to be resolved
app.use(languageMiddleware);

// Rate limit — DEUDA-046. The quota belongs to the account when the request carries a valid token
// and to the IP when it does not; `rateLimit.middleware.ts` holds the reasoning. It is a
// pass-through under test: the role matrix suite issues hundreds of requests from a single IP in
// one run, and the limiter would turn its last assertions into 429s
app.use(globalLimiter);

// Routes
app.use('/api', routes);

// Error handling middleware
app.use(errorHandler);

export {
    app,
    env,
    allowedOrigins
}
