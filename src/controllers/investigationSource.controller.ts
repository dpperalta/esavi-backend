import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationSourceService } from '../services/investigationSource.service';

// Create Investigation Source Controller
// Code: ESAVI-INVSRC-001
const createInvestigationSource = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationSourceService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationSource.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVSRC-001: Error creating Investigation Source: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationSource.createdFailed', req.lang), 500, 'INVSRC_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationSource
};
