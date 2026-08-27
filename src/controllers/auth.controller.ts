import { NextFunction, Request, Response } from 'express';
import {
    loginService,
    refreshTokenService,
    logoutService,
    logoutAllService,
    forgotPasswordService,
    resetPasswordService
} from '../services/auth.service';
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

// Close the session the refresh token belongs to
// Code: ESAVI-AUTH-003
const logout = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try{
        await logoutService(req.body.refreshToken, req.lang);
        // No `data`: closing a session is a state operation, and CONVENTIONS.md 10 keeps those
        // to the envelope alone
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.logoutSuccess', req.lang)
        });
    } catch( error ) {
        esaviLog('ESAVI-AUTH-003 - Error during logout process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.logoutFailed', req.lang), 500, 'AUTH_003_LOGOUT_FAILED', error));
    }
}

// Close every live session of the authenticated user
// Code: ESAVI-AUTH-004
const logoutAll = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try{
        // The identity comes from the token, never from the body. tokenValidation has already
        // re-fetched the user from the database, so req.user is a proven identity
        const result = await logoutAllService(req.user!.userId, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.logoutAllSuccess', req.lang, { count: `${ result.revokedCount }` }),
            data: result
        });
    } catch( error ) {
        esaviLog('ESAVI-AUTH-004 - Error during logout all process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.logoutAllFailed', req.lang), 500, 'AUTH_004_LOGOUT_ALL_FAILED', error));
    }
}

// Request a password reset link
// Code: ESAVI-AUTH-006
const forgotPassword = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try{
        // Trace of where the request came from. Both come from the request, never from the body:
        // a client must not be able to declare the IP or the User-Agent of its own request
        await forgotPasswordService(req.body, req.lang, {
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
        });
        // THE SAME ANSWER IN EVERY CASE — account or no account, delivery or no delivery. No
        // `data`: there is nothing to return, and anything returned would tell the two paths
        // apart. The message is written in the conditional for the same reason
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.forgotPasswordSuccess', req.lang)
        });
    } catch( error ) {
        // Only a failure to WRITE the request reaches here. A failure to deliver it was already
        // logged by the service and answered 200
        esaviLog('ESAVI-AUTH-006 - Error during forgot password process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.forgotPasswordFailed', req.lang), 500, 'AUTH_006_FORGOT_PASSWORD_FAILED', error));
    }
}

// Consume a reset token and write the new password
// Code: ESAVI-AUTH-007
const resetPassword = async( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try{
        // The credential is the token in the body, and the service checks it against
        // `appPasswordReset`. The controller verifies nothing about it
        await resetPasswordService(req.body, req.lang);
        // No `data`: the new password does not come back, neither does the user, and no session
        // token is issued — after resetting, the client goes to the login like anybody else
        return res.status(200).json({
            ok: true,
            message: getMessage('auth.resetPasswordSuccess', req.lang)
        });
    } catch( error ) {
        // The token is deliberately absent from this line: it is a live credential
        esaviLog('ESAVI-AUTH-007 - Error during reset password process: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('auth.resetPasswordFailed', req.lang), 500, 'AUTH_007_RESET_PASSWORD_FAILED', error));
    }
}

export {
    login,
    refresh,
    logout,
    logoutAll,
    forgotPassword,
    resetPassword
}