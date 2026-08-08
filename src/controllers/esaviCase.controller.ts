import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createEsaviCaseService } from '../services/esaviCase.service';

// Create ESAVI Case Controller
// Code: ESAVI-CASE-001
const createEsaviCase = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createEsaviCaseService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('esaviCase.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-001: Error creating ESAVI Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.createdFailed', req.lang), 500, 'CASE_001_CREATION_FAILED', error));
    }
}

export {
    createEsaviCase
}
