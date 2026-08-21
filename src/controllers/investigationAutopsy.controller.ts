import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationAutopsyService } from '../services/investigationAutopsy.service';

// Create Investigation Autopsy Controller
// Code: ESAVI-INVAUT-001
const createInvestigationAutopsy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationAutopsyService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationAutopsy.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVAUT-001: Error creating Investigation Autopsy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAutopsy.createdFailed', req.lang), 500, 'INVAUT_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationAutopsy
};
