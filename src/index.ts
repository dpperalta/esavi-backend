import { styleText } from 'node:util';
import { app, env, allowedOrigins } from './app';
import { connectDatabase } from './database/connection';
import { initModels } from './models';
import { esaviLog } from './helpers/esaviLogs.helper';

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
