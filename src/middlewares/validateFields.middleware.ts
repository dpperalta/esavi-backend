import { Request, Response, NextFunction } from 'express';
import { validationResult }  from 'express-validator';
import { getMessage } from '../helpers/i18n.helper';

export const validateFields = 
(req: Request, res: Response, next: NextFunction): Response | void => {
    const errors = validationResult(req);
    const errorsArray = errors.array();
    let errorMessage = '';
        for( let i=0; i<errorsArray.length; i++ ) {
            i > 0 ? errorMessage = `${ errorMessage }, ${ errorsArray[i].msg }` : errorMessage = `${ errorMessage } ${ errorsArray[i].msg }`;
        }

    if( !errors.isEmpty() ) {
        return res.status(400).json({
            ok: false,
            message: getMessage('common.validationError', req.lang),
            errors: errorMessage,
            detail: errors.array()
        });
    }
    next();
}