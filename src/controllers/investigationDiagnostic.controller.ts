import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createInvestigationDiagnosticService,
    getAllInvestigationDiagnosticsByInvestigationService,
    getInvestigationDiagnosticByIdService,
    getInvestigationDiagnosticsByInvestigationService
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

// Get Active Investigation Diagnostics By Investigation Controller
// Code: ESAVI-INVDIAG-002A
const getInvestigationDiagnosticsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationDiagnosticsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationDiagnostic.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVDIAG-002A: Error fetching Investigation Diagnostics by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationDiagnostic.getFailed', req.lang), 500, 'INVDIAG_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Diagnostics By Investigation Controller - For Admin
// Code: ESAVI-INVDIAG-002B
const getAllInvestigationDiagnosticsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationDiagnosticsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationDiagnostic.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVDIAG-002B: Error fetching all Investigation Diagnostics by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationDiagnostic.getFailed', req.lang), 500, 'INVDIAG_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Diagnostic By ID Controller
// Code: ESAVI-INVDIAG-003
const getInvestigationDiagnosticById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getInvestigationDiagnosticByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationDiagnostic.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVDIAG-003: Error fetching Investigation Diagnostic by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationDiagnostic.getFailed', req.lang), 500, 'INVDIAG_003_FETCH_FAILED', error));
    }
}

export {
    createInvestigationDiagnostic,
    getInvestigationDiagnosticsByInvestigation,
    getAllInvestigationDiagnosticsByInvestigation,
    getInvestigationDiagnosticById
};
