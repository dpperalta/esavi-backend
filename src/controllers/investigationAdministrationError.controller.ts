import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationAdministrationErrorService } from '../services/investigationAdministrationError.service';

// Create Investigation Administration Error Controller
// Code: ESAVI-INVADMER-001
const createInvestigationAdministrationError = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationAdministrationErrorService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationAdministrationError.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVADMER-001: Error creating Investigation Administration Error: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAdministrationError.createdFailed', req.lang), 500, 'INVADMER_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationAdministrationError
};
