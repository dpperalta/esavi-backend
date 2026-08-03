import { NextFunction, Request, Response } from 'express';
import { loginService } from '../services/auth.service';
import { esaviLog, getMessage, AppError } from '../helpers';

// Execute login process
// Code: ESAVI-AUTH-001
const login = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void   > => {
    try{
        const result = await loginService(req.body, req.lang);
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

export {
    login
}