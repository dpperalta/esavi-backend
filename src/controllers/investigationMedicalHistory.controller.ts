import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationMedicalHistoryListFilters } from '../types';
import {
    createInvestigationMedicalHistoryService,
    getAllInvestigationMedicalHistoriesService,
    getInvestigationMedicalHistoriesService,
    getInvestigationMedicalHistoryByCaseIdService,
    getInvestigationMedicalHistoryByIdService
} from '../services/investigationMedicalHistory.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationMedicalHistoryListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

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

// Get Investigation Medical Histories Controller
// Code: ESAVI-INVMEDH-002A
const getInvestigationMedicalHistories = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationMedicalHistoriesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationMedicalHistory.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVMEDH-002A: Error fetching Investigation Medical Histories: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationMedicalHistory.getFailedPlural', req.lang), 500, 'INVMEDH_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Medical Histories Controller - For Admin
// Code: ESAVI-INVMEDH-002B
const getAllInvestigationMedicalHistories = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationMedicalHistoriesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationMedicalHistory.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVMEDH-002B: Error fetching all Investigation Medical Histories: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationMedicalHistory.getFailedPlural', req.lang), 500, 'INVMEDH_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Medical History By ID Controller
// Code: ESAVI-INVMEDH-003
// canViewInactive is what lets a SUPERADMIN read the medical history of a retired investigation:
// the entity has no state of its own, so the predicate is applied over the visibility it inherits
const getInvestigationMedicalHistoryById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationMedicalHistoryByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVMEDH-003: Error fetching Investigation Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationMedicalHistory.getFailed', req.lang), 500, 'INVMEDH_003_FETCH_FAILED', error));
    }
}

// Get Investigation Medical History By Case ID Controller
// Code: ESAVI-INVMEDH-006
// The only non-canonical operation of the entity. It returns the record itself, not { count, rows }:
// the chain case -> investigation -> medical history is one to one on both hops
const getInvestigationMedicalHistoryByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getInvestigationMedicalHistoryByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVMEDH-006: Error fetching Investigation Medical History by Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationMedicalHistory.getFailed', req.lang), 500, 'INVMEDH_006_FETCH_FAILED', error));
    }
}

export {
    createInvestigationMedicalHistory,
    getInvestigationMedicalHistories,
    getAllInvestigationMedicalHistories,
    getInvestigationMedicalHistoryById,
    getInvestigationMedicalHistoryByCaseId
}
