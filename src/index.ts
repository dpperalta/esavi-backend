import { styleText } from 'node:util';
import { app, env, allowedOrigins } from './app';
import { connectDatabase } from './database/connection';
import { initModels } from './models';
import { esaviLog, esaviLogFlush } from './helpers/esaviLogs.helper';
import { AVAILABLE_LANGUAGES } from './helpers/i18n.helper';

const PORT = process.env.PORT || 3000;

/**
 * Stops the boot when DEFAULT_LANGUAGE names a language the application cannot serve.
 * Same policy resolveCorsOrigins() applies to CORS_ORIGINS: fail loudly instead of
 * degrading into a language nobody configured.
 */
const validateDefaultLanguage = async (): Promise<void> => {
    const defaultLanguage = ( process.env.DEFAULT_LANGUAGE ?? '' ).trim();

    if( !defaultLanguage ) {
        esaviLog(`[START]: DEFAULT_LANGUAGE is not set. Falling back to '${ AVAILABLE_LANGUAGES[0] }'.`, 'warn');
        return;
    }

    const declared = ( process.env.SUPPORTED_LANGUAGES ?? '' )
        .split(',')
        .map( lang => lang.trim() )
        .filter( lang => lang.length > 0 );

    // A language is usable only if SUPPORTED_LANGUAGES declares it and a catalogue exists for it.
    const usable = ( declared.length > 0 ? declared : AVAILABLE_LANGUAGES as string[] )
        .filter( lang => ( AVAILABLE_LANGUAGES as string[] ).includes(lang) );

    if( !usable.includes(defaultLanguage) ) {
        const message = `DEFAULT_LANGUAGE='${ defaultLanguage }' is not supported. Allowed values: ${ usable.join(', ') || 'none' }`;
        console.error(styleText('red', `Error starting server: ${ message }`));
        esaviLog(`Error starting server: ${ message }`, 'error');
        await esaviLogFlush();
        process.exit(1);
    }
}

const startServer = async (): Promise<void> => {
    try {
        await validateDefaultLanguage();
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
