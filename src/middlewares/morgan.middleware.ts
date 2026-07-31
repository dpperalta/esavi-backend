import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { Request } from 'express';

const logDirectory = path.join(process.cwd(), 'src/logs');

if( !fs.existsSync(logDirectory) ) {
    fs.mkdirSync(logDirectory, { recursive: true });
}

const accessLogStrem = fs.createWriteStream(
    path.join(logDirectory, 'access.log'),
    { flags: 'a' }
);

// Custom format
morgan.token('body', (req: Request) => JSON.stringify(req.body));

const morganMiddleware = morgan(
    ':date[iso] :method :url :status :res[content-length] - :response-time ms :body',
    { stream: accessLogStrem }
);

export { morganMiddleware };