import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationSourceListFilters } from '../types';
import {
    createInvestigationSourceService,
    getAllInvestigationSourcesService,
    getInvestigationSourceByIdService,
    getInvestigationSourcesService
} from '../services/investigationSource.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationSourceListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Source Controller
// Code: ESAVI-INVSRC-001
const createInvestigationSource = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationSourceService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationSource.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVSRC-001: Error creating Investigation Source: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationSource.createdFailed', req.lang), 500, 'INVSRC_001_CREATION_FAILED', error));
    }
}

// Get Investigation Sources Controller
// Code: ESAVI-INVSRC-002A
const getInvestigationSources = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationSourcesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationSource.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVSRC-002A: Error fetching Investigation Sources: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationSource.getFailedPlural', req.lang), 500, 'INVSRC_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Sources Controller - For Admin
// Code: ESAVI-INVSRC-002B
const getAllInvestigationSources = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationSourcesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationSource.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVSRC-002B: Error fetching all Investigation Sources: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationSource.getFailedPlural', req.lang), 500, 'INVSRC_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Source By ID Controller
// Code: ESAVI-INVSRC-003
const getInvestigationSourceById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationSourceByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationSource.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVSRC-003: Error fetching Investigation Source by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationSource.getFailed', req.lang), 500, 'INVSRC_003_FETCH_FAILED', error));
    }
}

export {
    createInvestigationSource,
    getInvestigationSources,
    getAllInvestigationSources,
    getInvestigationSourceById
};
