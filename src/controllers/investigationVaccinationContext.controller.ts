import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationVaccinationContextListFilters } from '../types';
import {
    createInvestigationVaccinationContextService,
    getAllInvestigationVaccinationContextsService,
    getInvestigationVaccinationContextByIdService,
    getInvestigationVaccinationContextsService
} from '../services/investigationVaccinationContext.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationVaccinationContextListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Vaccination Context Controller
// Code: ESAVI-INVVACTX-001
const createInvestigationVaccinationContext = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationVaccinationContextService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationVaccinationContext.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACTX-001: Error creating Investigation Vaccination Context: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccinationContext.createdFailed', req.lang), 500, 'INVVACTX_001_CREATION_FAILED', error));
    }
}

// Get Investigation Vaccination Contexts Controller
// Code: ESAVI-INVVACTX-002A
const getInvestigationVaccinationContexts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationVaccinationContextsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccinationContext.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACTX-002A: Error fetching Investigation Vaccination Contexts: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccinationContext.getFailedPlural', req.lang), 500, 'INVVACTX_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Vaccination Contexts Controller - For Admin
// Code: ESAVI-INVVACTX-002B
const getAllInvestigationVaccinationContexts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationVaccinationContextsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccinationContext.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACTX-002B: Error fetching all Investigation Vaccination Contexts: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccinationContext.getFailedPlural', req.lang), 500, 'INVVACTX_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Vaccination Context By ID Controller
// Code: ESAVI-INVVACTX-003
// canViewInactive is what lets a SUPERADMIN read the vaccination context of a retired investigation:
// the entity has no state of its own, so the predicate is applied over the visibility it inherits
const getInvestigationVaccinationContextById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationVaccinationContextByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccinationContext.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACTX-003: Error fetching Investigation Vaccination Context: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccinationContext.getFailed', req.lang), 500, 'INVVACTX_003_FETCH_FAILED', error));
    }
}

export {
    createInvestigationVaccinationContext,
    getAllInvestigationVaccinationContexts,
    getInvestigationVaccinationContextById,
    getInvestigationVaccinationContexts
};
