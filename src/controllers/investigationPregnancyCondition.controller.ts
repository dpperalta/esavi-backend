import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationPregnancyConditionService
} from '../services/investigationPregnancyCondition.service';

// Create Investigation Pregnancy Condition Controller
// Code: ESAVI-INVPREG-001
const createInvestigationPregnancyCondition = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationPregnancyConditionService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationPregnancyCondition.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVPREG-001: Error creating Investigation Pregnancy Condition: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationPregnancyCondition.createdFailed', req.lang), 500, 'INVPREG_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationPregnancyCondition
}
