import { Request, Response, NextFunction } from 'express';
import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';

export const errorHandler = (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    console.error('ERROR:', error);
    // A rejection can happen before anyone read the body — `tokenValidation` and `validateUserRole`
    // run ahead of multer, so an upload rejected with 401 or 403 still has megabytes in flight.
    // Answering and closing while the client is still writing resets the connection, and the
    // client sees ECONNRESET instead of the status. Draining discards the rest of the request
    // cheaply and lets the response arrive.
    if( !req.complete ) {
        req.resume();
    }
    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            ok: false,
            message: error.message,
            code: error.code,
            //errors: error.originalError ? error.originalError : 'Unknown error'
            errors: process.env.NODE_ENV === 'development' && error.originalError ? (error.originalError instanceof Error ? error.originalError.message : String(error.originalError)) : 'Internal server error'
         });
         return;
    }   
    res.status(500).json({
        ok: false,
        message: getMessage('common.internalError', req.lang),
        code: 'INTERNAL_SERVER_ERROR',
        //errors: error instanceof Error ? error.message : 'Internal server error'
        errors: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : 'Internal server error'
    });
}