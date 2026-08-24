import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationClinicalEvaluationListFilters } from '../types';
import {
    createInvestigationClinicalEvaluationService,
    getAllInvestigationClinicalEvaluationsService,
    getInvestigationClinicalEvaluationByCaseIdService,
    getInvestigationClinicalEvaluationByIdService,
    getInvestigationClinicalEvaluationsService,
    updateInvestigationClinicalEvaluationService
} from '../services/investigationClinicalEvaluation.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationClinicalEvaluationListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

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

// Get Investigation Clinical Evaluations Controller
// Code: ESAVI-INVCLIEV-002A
const getInvestigationClinicalEvaluations = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationClinicalEvaluationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-002A: Error fetching Investigation Clinical Evaluations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.getFailedPlural', req.lang), 500, 'INVCLIEV_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Clinical Evaluations Controller - For Admin
// Code: ESAVI-INVCLIEV-002B
const getAllInvestigationClinicalEvaluations = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationClinicalEvaluationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-002B: Error fetching all Investigation Clinical Evaluations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.getFailedPlural', req.lang), 500, 'INVCLIEV_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Clinical Evaluation By ID Controller
// Code: ESAVI-INVCLIEV-003
// canViewInactive is what lets a SUPERADMIN read the clinical evaluation of a retired investigation:
// the entity has no state of its own, so the predicate is applied over the visibility it inherits
const getInvestigationClinicalEvaluationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationClinicalEvaluationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-003: Error fetching Investigation Clinical Evaluation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.getFailed', req.lang), 500, 'INVCLIEV_003_FETCH_FAILED', error));
    }
}

// Get Investigation Clinical Evaluation By Case ID Controller
// Code: ESAVI-INVCLIEV-006
// The only non-canonical operation of the entity. It returns the record itself, not { count, rows }:
// the chain case -> investigation -> clinical evaluation is one to one on both hops
const getInvestigationClinicalEvaluationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getInvestigationClinicalEvaluationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-006: Error fetching Investigation Clinical Evaluation by Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.getFailed', req.lang), 500, 'INVCLIEV_006_FETCH_FAILED', error));
    }
}

// Update Investigation Clinical Evaluation Controller
// Code: ESAVI-INVCLIEV-004
// The main operation of the entity: the row is opened empty and completed over time
const updateInvestigationClinicalEvaluation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateInvestigationClinicalEvaluationService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationClinicalEvaluation.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCLIEV-004: Error updating Investigation Clinical Evaluation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationClinicalEvaluation.updatedFailed', req.lang), 500, 'INVCLIEV_004_UPDATE_FAILED', error));
    }
}

export {
    createInvestigationClinicalEvaluation,
    getInvestigationClinicalEvaluations,
    getAllInvestigationClinicalEvaluations,
    getInvestigationClinicalEvaluationById,
    getInvestigationClinicalEvaluationByCaseId,
    updateInvestigationClinicalEvaluation
}
