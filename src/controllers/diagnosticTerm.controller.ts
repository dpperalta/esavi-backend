import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createDiagnosticTermService } from '../services/diagnosticTerm.service';

// Create Diagnostic Term Controller
// Code: ESAVI-DIAGTERM-001
const createDiagnosticTerm = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createDiagnosticTermService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('diagnosticTerm.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-001: Error creating Diagnostic Term: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.createdFailed', req.lang), 500, 'DIAGTERM_001_CREATION_FAILED', error));
    }
}

export {
    createDiagnosticTerm
}
