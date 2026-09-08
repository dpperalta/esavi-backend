import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationDiagnosticService
} from '../services/investigationDiagnostic.service';

// Create Investigation Diagnostic Controller
// Code: ESAVI-INVDIAG-001
const createInvestigationDiagnostic = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationDiagnosticService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationDiagnostic.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVDIAG-001: Error creating Investigation Diagnostic: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationDiagnostic.createdFailed', req.lang), 500, 'INVDIAG_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationDiagnostic
};
