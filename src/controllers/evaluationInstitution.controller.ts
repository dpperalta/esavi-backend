import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createEvaluationInstitutionService
} from '../services/evaluationInstitution.service';

// Create Evaluation Institution Controller
// Code: ESAVI-EVALINST-001
const createEvaluationInstitution = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createEvaluationInstitutionService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('evaluationInstitution.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-EVALINST-001: Error creating Evaluation Institution: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('evaluationInstitution.createdFailed', req.lang), 500, 'EVALINST_001_CREATION_FAILED', error));
    }
}

export {
    createEvaluationInstitution
}
