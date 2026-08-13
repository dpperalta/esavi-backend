import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import { DiagnosticTermListFilters, ImportDiagnosticTermsInput } from '../types';
import {
    createDiagnosticTermService,
    getActiveDiagnosticTermsService,
    getAllDiagnosticTermsService,
    getDiagnosticTermByIdService,
    updateDiagnosticTermService,
    setDiagnosticTermActivationService,
    importDiagnosticTermsService
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

// Get Diagnostic Term by ID Controller
// Code: ESAVI-DIAGTERM-003
const getDiagnosticTermById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getDiagnosticTermByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-003: Error getting Diagnostic Term by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.getFailed', req.lang), 500, 'DIAGTERM_003_FETCH_FAILED', error));
    }
}

// Update Diagnostic Term Controller
// Code: ESAVI-DIAGTERM-004
const updateDiagnosticTerm = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateDiagnosticTermService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-004: Error updating Diagnostic Term: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.updatedFailed', req.lang), 500, 'DIAGTERM_004_UPDATE_FAILED', error));
    }
}

// Delete Diagnostic Term Controller - Soft delete
// Code: ESAVI-DIAGTERM-005A
const deleteDiagnosticTerm = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setDiagnosticTermActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-005A: Error deleting Diagnostic Term: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.deletedFailed', req.lang), 500, 'DIAGTERM_005A_DELETE_FAILED', error));
    }
}

// Activate Diagnostic Term Controller - For SuperAdmin
// Code: ESAVI-DIAGTERM-005B
const activateDiagnosticTerm = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setDiagnosticTermActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-005B: Error activating Diagnostic Term: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.activatedFailed', req.lang), 500, 'DIAGTERM_005B_ACTIVATION_FAILED', error));
    }
}

// Import Diagnostic Terms Controller - For SuperAdmin
// Code: ESAVI-DIAGTERM-007
const importDiagnosticTerms = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    // A request with no multipart body at all leaves req.body undefined — multer only fills it when
    // it has something to parse — and that is precisely the request that must end in a 400 for the
    // missing file, not in a 500 for reading a key off undefined
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Everything arrives as a text field of the multipart body, so the booleans come as strings and
    // are turned into values here. The file itself was left in req.file by uploadSingleFile
    const data: ImportDiagnosticTermsInput = {
        source: body.source ? (body.source as ImportDiagnosticTermsInput['source']) : undefined,
        termGroup: body.termGroup ? (body.termGroup as string).trim() : undefined,
        dictionaryVersion: body.dictionaryVersion ? (body.dictionaryVersion as string).trim() : undefined,
        encoding: body.encoding ? (body.encoding as ImportDiagnosticTermsInput['encoding']) : undefined,
        dryRun: body.dryRun !== undefined ? String(body.dryRun) === 'true' : undefined
    };
    try {
        // 200 and not 201: there is no identifiable resource to return and no URL to point at.
        // What comes back is the report of a process
        const report = await importDiagnosticTermsService(req.file?.buffer, data, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('diagnosticTerm.importedSuccess', req.lang),
            data: report
        });
    } catch (error) {
        esaviLog('ESAVI-DIAGTERM-007: Error importing Diagnostic Terms: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diagnosticTerm.importedFailed', req.lang), 500, 'DIAGTERM_007_IMPORT_FAILED', error));
    }
}

export {
    createDiagnosticTerm,
    getDiagnosticTerms,
    getAllDiagnosticTerms,
    getDiagnosticTermById,
    updateDiagnosticTerm,
    deleteDiagnosticTerm,
    activateDiagnosticTerm,
    importDiagnosticTerms
}
