import logs4js from 'log4js';
import fs from 'fs';

const path = './src/logs/esaviLog.log';

// Validate if the log file directory exists if not create it
if( !fs.existsSync( path ) ){
    fs.mkdirSync('./src/logs', { recursive: true });
    fs.writeFileSync(path,  '', 'utf-8');
}

logs4js.configure({
    appenders: {
        fileAppender: {
            type: 'file',
            filename: path,
            maxLogSize: 10485760, // 10MB
        }
    },
    categories: {
        default: { 
            appenders: ['fileAppender'], 
            level: 'trace' 
        }
    }
});

const logger = logs4js.getLogger();

const esaviLog = (message: string, type: 'info' | 'error' | 'warn' | 'debug' | 'trace' | 'fatal') => {
    switch(type) {
        case 'info':
            logger.info(message);
            break;
        case 'error':
            logger.error(message);
            break;
        case 'warn':
            logger.warn(message);
            break;
        case 'debug':
            logger.debug(message);
            break;
        case 'trace':
            logger.trace(message);
            break;
        case 'fatal':
            logger.fatal(message);
            break;
        default:
            logger.info('[Unknown]: ' + message);
            break;
    }
}

// log4js writes asynchronously, so a process.exit() right after esaviLog() drops the entry.
// Await this before exiting on purpose.
const esaviLogFlush = (): Promise<void> => new Promise( resolve => logs4js.shutdown(() => resolve()) );

export { esaviLog, esaviLogFlush };