import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { InvestigationAutopsyListFilters } from '../types';
import {
    createInvestigationAutopsyService,
    getAllInvestigationAutopsiesService,
    getInvestigationAutopsiesService
} from '../services/investigationAutopsy.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationAutopsyListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Autopsy Controller
// Code: ESAVI-INVAUT-001
const createInvestigationAutopsy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationAutopsyService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationAutopsy.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVAUT-001: Error creating Investigation Autopsy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAutopsy.createdFailed', req.lang), 500, 'INVAUT_001_CREATION_FAILED', error));
    }
}

// Get Investigation Autopsies Controller
// Code: ESAVI-INVAUT-002A
const getInvestigationAutopsies = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationAutopsiesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationAutopsy.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVAUT-002A: Error fetching Investigation Autopsies: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAutopsy.getFailedPlural', req.lang), 500, 'INVAUT_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Autopsies Controller - For Admin
// Code: ESAVI-INVAUT-002B
const getAllInvestigationAutopsies = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationAutopsiesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationAutopsy.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVAUT-002B: Error fetching all Investigation Autopsies: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAutopsy.getFailedPlural', req.lang), 500, 'INVAUT_002B_FETCH_FAILED', error));
    }
}

export {
    createInvestigationAutopsy,
    getInvestigationAutopsies,
    getAllInvestigationAutopsies
};
