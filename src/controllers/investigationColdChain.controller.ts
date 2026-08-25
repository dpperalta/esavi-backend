import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { InvestigationColdChainListFilters } from '../types';
import {
    createInvestigationColdChainService,
    getAllInvestigationColdChainsService,
    getInvestigationColdChainsService
} from '../services/investigationColdChain.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationColdChainListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Cold Chain Controller
// Code: ESAVI-INVCOLD-001
const createInvestigationColdChain = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationColdChainService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationColdChain.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-001: Error creating Investigation Cold Chain: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.createdFailed', req.lang), 500, 'INVCOLD_001_CREATION_FAILED', error));
    }
}


// Get Investigation Cold Chains Controller
// Code: ESAVI-INVCOLD-002A
const getInvestigationColdChains = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationColdChainsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-002A: Error fetching Investigation Cold Chains: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.getFailedPlural', req.lang), 500, 'INVCOLD_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Cold Chains Controller - For Admin
// Code: ESAVI-INVCOLD-002B
const getAllInvestigationColdChains = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationColdChainsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-002B: Error fetching all Investigation Cold Chains: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.getFailedPlural', req.lang), 500, 'INVCOLD_002B_FETCH_FAILED', error));
    }
}

export {
    createInvestigationColdChain,
    getAllInvestigationColdChains,
    getInvestigationColdChains
};
