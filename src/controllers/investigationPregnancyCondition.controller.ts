import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createInvestigationPregnancyConditionService,
    getAllInvestigationPregnancyConditionsByInvestigationService,
    getInvestigationPregnancyConditionByIdService,
    getInvestigationPregnancyConditionsByInvestigationService
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

// Get Active Investigation Pregnancy Conditions By Investigation Controller
// Code: ESAVI-INVPREG-002A
const getInvestigationPregnancyConditionsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationPregnancyConditionsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationPregnancyCondition.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVPREG-002A: Error fetching Investigation Pregnancy Conditions by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationPregnancyCondition.getFailed', req.lang), 500, 'INVPREG_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Pregnancy Conditions By Investigation Controller - For Admin
// Code: ESAVI-INVPREG-002B
const getAllInvestigationPregnancyConditionsByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationPregnancyConditionsByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationPregnancyCondition.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVPREG-002B: Error fetching all Investigation Pregnancy Conditions by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationPregnancyCondition.getFailed', req.lang), 500, 'INVPREG_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Pregnancy Condition By ID Controller
// Code: ESAVI-INVPREG-003
const getInvestigationPregnancyConditionById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getInvestigationPregnancyConditionByIdService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationPregnancyCondition.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVPREG-003: Error fetching Investigation Pregnancy Condition by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationPregnancyCondition.getFailed', req.lang), 500, 'INVPREG_003_FETCH_FAILED', error));
    }
}

export {
    createInvestigationPregnancyCondition,
    getInvestigationPregnancyConditionById,
    getInvestigationPregnancyConditionsByInvestigation,
    getAllInvestigationPregnancyConditionsByInvestigation
}
