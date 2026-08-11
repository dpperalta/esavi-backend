import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createClassificationService } from '../services/classification.service';

// Create Classification Controller
// Code: ESAVI-CLASSIF-001
const createClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createClassificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('classification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CLASSIF-001: Error creating Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('classification.createdFailed', req.lang), 500, 'CLASSIF_001_CREATION_FAILED', error));
    }
}

export {
    createClassification
}
