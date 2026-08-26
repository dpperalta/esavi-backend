import { NextFunction, Request, Response } from 'express';
import { loginService, refreshTokenService } from '../services/auth.service';
import { esaviLog, getMessage, AppError } from '../helpers';

// Execute login process
// Code: ESAVI-AUTH-001
const login = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void   > => {
    try{
        // Trace of where the session was opened from. Both come from the request, never from the
        // body: a client must not be able to declare the IP or the User-Agent of its own session
        const result = await loginService(req.body, req.lang, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.loginSuccess', req.lang, { name: `${result.user.displayName}` }),
            data: result
        });
    } catch( error ) {
        esaviLog('ESAVI-AUTH-001 - Error during login process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.loginFailed', req.lang), 500, 'AUTH_001_LOGIN_FAILED', error));
    }
}

// Renew the pair of credentials from a refresh token
// Code: ESAVI-AUTH-002
const refresh = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try{
        // Only the tokens: a renewal is not a login, so it does not repeat the `user` block nor
        // pay for the roles include on what is the most frequent call of the whole mechanism
        const result = await refreshTokenService(req.body.refreshToken, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.refreshSuccess', req.lang),
            data: result
        });
    } catch( error ) {
        esaviLog('ESAVI-AUTH-002 - Error during refresh process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.refreshFailed', req.lang), 500, 'AUTH_002_REFRESH_FAILED', error));
    }
}

export {
    login,
    refresh
}