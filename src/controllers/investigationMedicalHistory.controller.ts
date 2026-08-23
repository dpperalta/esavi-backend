import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationMedicalHistoryService } from '../services/investigationMedicalHistory.service';

// Create Investigation Medical History Controller
// Code: ESAVI-INVMEDH-001
const createInvestigationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationMedicalHistoryService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationMedicalHistory.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVMEDH-001: Error creating Investigation Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationMedicalHistory.createdFailed', req.lang), 500, 'INVMEDH_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationMedicalHistory
}
