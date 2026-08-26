import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createFinalClassificationService } from '../services/finalClassification.service';

// Create Final Classification Controller
// Code: ESAVI-FINCLASS-001
const createFinalClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createFinalClassificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('finalClassification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-001: Error creating Final Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.createdFailed', req.lang), 500, 'FINCLASS_001_CREATION_FAILED', error));
    }
}

export {
    createFinalClassification
}
