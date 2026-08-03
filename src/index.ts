import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import routes from './routes';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { styleText } from 'node:util';
import { connectDatabase, sequelize } from './database/connection';
import { initModels } from './models';
import { esaviLog } from './helpers/esaviLogs.helper';
import { morganMiddleware }  from './middlewares/morgan.middleware';
import { languageMiddleware } from './middlewares/language.middleware';
import { errorHandler } from './middlewares/errorHandler.middleware';

const env = process.env.NODE_ENV || 'development';

dotenv.config({
    path: path.resolve(process.cwd(), `.env.${env}`)
});

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

app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
}));

// Language middleware
app.use(languageMiddleware);

// Routes
app.use('/api', routes);

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 3000;

const startServer = async (): Promise<void> => {
    try {
        initModels();
        await connectDatabase();

        app.listen(PORT, () => {
            console.log(styleText('green',`Server running on port ${ PORT }`));
            console.log(styleText('blue',`Environment: ${ env }`));
            console.log(styleText('magentaBright',`Server time: ${ new Date().toISOString() }`));
            esaviLog(`[START]: Server running on port ${ PORT }`, 'info');
            esaviLog(`[START]: Environment: ${ env }`, 'info');
            esaviLog(`[START]: Server time: ${ new Date().toISOString() }`, 'info');
            esaviLog(`[START]: Allowed CORS origins: ${ allowedOrigins.join(', ') }`, 'info');
        });
    } catch (error) {
        console.error(styleText('red',`Error starting server: ${error instanceof Error ? error.message : String(error)}`));
        esaviLog(`Error starting server: ${error instanceof Error ? error.message : String(error)}`, 'error');
        process.exit(1);
    }
}

startServer();