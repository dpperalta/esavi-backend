import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationClinicalEvaluationService
} from '../services/investigationClinicalEvaluation.service';

// Create Investigation Clinical Evaluation Controller
// Code: ESAVI-INVCLIEV-001
const createInvestigationClinicalEvaluation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationClinicalEvaluationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-001: Error creating Investigation Clinical Evaluation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.createdFailed', req.lang), 500, 'INVCLIEV_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationClinicalEvaluation
}
