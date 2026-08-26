import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationCommunityService } from '../services/investigationCommunity.service';

// Create Investigation Community Controller
// Code: ESAVI-INVCOMM-001
const createInvestigationCommunity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationCommunityService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationCommunity.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-001: Error creating Investigation Community: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.createdFailed', req.lang), 500, 'INVCOMM_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationCommunity
}
