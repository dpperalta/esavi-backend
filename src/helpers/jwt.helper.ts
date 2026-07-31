import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { esaviLog } from './esaviLogs.helper';

interface JwtPayload {
    userId: string;
    email?: string;
    displayName?: string;
    roles?: Array<{
        roleId: string;
        name: string;
        code: string;
    }>;
}

const jwtGenerate = ( user: JwtPayload ) => {
    const jwtSecret = process.env.JWT_SECRET as Secret;
    const jwtExpiresIn = process.env.JWT_EXPIRES_IN as SignOptions['expiresIn'];
    return new Promise(( resolve, reject ) => {
        const payload = { user };
        jwt.sign( payload, jwtSecret, {
            expiresIn: jwtExpiresIn || '8h'
        }, ( err, token ) => {
            if ( err ) {
                esaviLog('[ERROR]: JWT generation error: ' + err, 'error');
                reject(err);
            } else {
                resolve(token);
            }
        });
    });
}

export{
    jwtGenerate
}