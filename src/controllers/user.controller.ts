import { NextFunction, Request, Response } from 'express';
import { createUserService } from '../services/user.service';
import { esaviLog, getMessage, AppError } from '../helpers';

// Create User Controller
// Code: ESAVI-USER-001
const createUser = async ( req: Request, res: Response, next: NextFunction ): Promise<Response | void> => {
    try {
        const data = await createUserService({ data: req.body, authUser: req.user, lang: req.lang });
        return res.status(201).json({
            ok: true,
            message: getMessage('user.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USER-001: Error creating user: ' + error,  'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('user.createdFailed', req.lang), 500, 'USER_001_CREATION_FAILED', error));
    }
}

export {
    createUser
}