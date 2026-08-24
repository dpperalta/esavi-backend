import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createEvaluationInstitutionService,
    getAllEvaluationInstitutionsByInvestigationService,
    getEvaluationInstitutionByIdService,
    getEvaluationInstitutionsByInvestigationService
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

// Get Active Evaluation Institutions By Investigation Controller
// Code: ESAVI-EVALINST-002A
const getEvaluationInstitutionsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getEvaluationInstitutionsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('evaluationInstitution.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-EVALINST-002A: Error fetching Evaluation Institutions by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('evaluationInstitution.getFailed', req.lang), 500, 'EVALINST_002A_FETCH_FAILED', error));
    }
}

// Get All Evaluation Institutions By Investigation Controller - For Admin
// Code: ESAVI-EVALINST-002B
const getAllEvaluationInstitutionsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllEvaluationInstitutionsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('evaluationInstitution.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-EVALINST-002B: Error fetching all Evaluation Institutions by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('evaluationInstitution.getFailed', req.lang), 500, 'EVALINST_002B_FETCH_FAILED', error));
    }
}

// Get Evaluation Institution By ID Controller
// Code: ESAVI-EVALINST-003
const getEvaluationInstitutionById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getEvaluationInstitutionByIdService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('evaluationInstitution.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-EVALINST-003: Error fetching Evaluation Institution by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('evaluationInstitution.getFailed', req.lang), 500, 'EVALINST_003_FETCH_FAILED', error));
    }
}

export {
    createEvaluationInstitution,
    getEvaluationInstitutionsByInvestigation,
    getAllEvaluationInstitutionsByInvestigation,
    getEvaluationInstitutionById
}
