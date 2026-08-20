import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationService } from '../services/investigation.service';

// Create Investigation Controller
// Code: ESAVI-INVESTGN-001
const createInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigation.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-001: Error creating Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.createdFailed', req.lang), 500, 'INVESTGN_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigation
}
