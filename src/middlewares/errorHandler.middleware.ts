import { Request, Response, NextFunction } from 'express';
import { AppError } from '../helpers/appError.helper';
import { getMessage } from '../helpers/i18n.helper';

export const errorHandler = (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    console.error('ERROR:', error);
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