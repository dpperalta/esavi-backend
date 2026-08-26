import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { InvestigationCommunityListFilters } from '../types';
import {
    createInvestigationCommunityService,
    getAllInvestigationCommunitiesService,
    getInvestigationCommunitiesService
} from '../services/investigationCommunity.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationCommunityListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Community Controller
// Code: ESAVI-INVCOMM-001
const createInvestigationCommunity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationCommunityService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationCommunity.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-001: Error creating Investigation Community: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.createdFailed', req.lang), 500, 'INVCOMM_001_CREATION_FAILED', error));
    }
}

// Get Investigation Communities Controller
// Code: ESAVI-INVCOMM-002A
const getInvestigationCommunities = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationCommunitiesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-002A: Error fetching Investigation Communities: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.getFailedPlural', req.lang), 500, 'INVCOMM_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Communities Controller - For Admin
// Code: ESAVI-INVCOMM-002B
// The admin variant of the dual listing. It is a controller of its own and not a branch of the 002A
// because the two are two routes: the role gate lives on the route, and the operation code keeps its
// letter in all five places
const getAllInvestigationCommunities = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationCommunitiesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-002B: Error fetching all Investigation Communities: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.getFailedPlural', req.lang), 500, 'INVCOMM_002B_FETCH_FAILED', error));
    }
}

export {
    createInvestigationCommunity,
    getAllInvestigationCommunities,
    getInvestigationCommunities
}
