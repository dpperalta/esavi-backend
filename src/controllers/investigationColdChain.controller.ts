import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationColdChainService } from '../services/investigationColdChain.service';

// Create Investigation Cold Chain Controller
// Code: ESAVI-INVCOLD-001
const createInvestigationColdChain = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationColdChainService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationColdChain.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-001: Error creating Investigation Cold Chain: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.createdFailed', req.lang), 500, 'INVCOLD_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationColdChain
};
