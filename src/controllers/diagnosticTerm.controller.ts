import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { DiagnosticTermListFilters } from '../types';
import {
    createDiagnosticTermService,
    getActiveDiagnosticTermsService,
    getAllDiagnosticTermsService
} from '../services/diagnosticTerm.service';

// Unwraps the query filters shared by both listings. reviewStatus is read here but ignored by the
// public listing, which never passes it on
const readListFilters = (query: Request['query']): DiagnosticTermListFilters => ({
    search: query.search ? (query.search as string).trim() : undefined,
    source: query.source ? (query.source as DiagnosticTermListFilters['source']) : undefined,
    termGroup: query.termGroup ? (query.termGroup as string).trim() : undefined
});

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

// Get Active Diagnostic Terms Controller
// Code: ESAVI-DIAGTERM-002A
const getDiagnosticTerms = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveDiagnosticTermsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-002A: Error getting Diagnostic Terms: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.getFailedPlural', req.lang), 500, 'DIAGTERM_002A_FETCH_FAILED', error));
    }
}

// Get All Diagnostic Terms Controller - For Admin
// Code: ESAVI-DIAGTERM-002B
const getAllDiagnosticTerms = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    // The fourth filter is added here and only here: reviewStatus is the review queue of the
    // catalog and has no place in the public listing
    const filters: DiagnosticTermListFilters = {
        ...readListFilters(req.query),
        reviewStatus: req.query.reviewStatus ? (req.query.reviewStatus as string).trim() : undefined
    };
    try {
        const data = await getAllDiagnosticTermsService(filters, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-002B: Error getting all Diagnostic Terms: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.getFailedPlural', req.lang), 500, 'DIAGTERM_002B_FETCH_FAILED', error));
    }
}

export {
    createDiagnosticTerm,
    getDiagnosticTerms,
    getAllDiagnosticTerms
}
