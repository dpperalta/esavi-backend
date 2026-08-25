import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationColdChainListFilters } from '../types';
import {
    createInvestigationColdChainService,
    getAllInvestigationColdChainsService,
    getInvestigationColdChainByCaseIdService,
    getInvestigationColdChainByIdService,
    getInvestigationColdChainsService,
    purgeInvestigationColdChainService,
    updateInvestigationColdChainService
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

// Get Investigation Cold Chain By ID Controller
// Code: ESAVI-INVCOLD-003
// canViewInactive is what lets a SUPERADMIN read the cold chain of a retired investigation: the
// entity has no state of its own, so the predicate is applied over the visibility it inherits
const getInvestigationColdChainById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationColdChainByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-003: Error fetching Investigation Cold Chain: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.getFailed', req.lang), 500, 'INVCOLD_003_FETCH_FAILED', error));
    }
}

// Get Investigation Cold Chain By Case ID Controller
// Code: ESAVI-INVCOLD-006
// The only non-canonical operation of the entity. It answers with the record itself and not with a
// collection: the chain case -> investigation -> cold chain is one to one on both hops
const getInvestigationColdChainByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getInvestigationColdChainByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-006: Error fetching Investigation Cold Chain by case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.getFailed', req.lang), 500, 'INVCOLD_006_FETCH_FAILED', error));
    }
}

// Update Investigation Cold Chain Controller
// Code: ESAVI-INVCOLD-004
// canViewInactive travels for the same reason as in the 003: the entity has no state of its own, so
// the predicate is applied over the visibility it inherits from its investigation
const updateInvestigationColdChain = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateInvestigationColdChainService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-004: Error updating Investigation Cold Chain: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.updatedFailed', req.lang), 500, 'INVCOLD_004_UPDATE_FAILED', error));
    }
}

// Purge Investigation Cold Chain Controller - Physical delete, for SuperAdmin
// Code: ESAVI-INVCOLD-005C
// Responds without `data`: the row no longer exists, so there is nothing to return. It is also the
// only operation of the entity that writes no appDetails entry, which CONVENTIONS.md declares
// correct — the row is destroyed in the same transaction any audit would have been written into
const purgeInvestigationColdChain = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        await purgeInvestigationColdChainService(id.toString().trim(), req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationColdChain.purgeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOLD-005C: Error purging Investigation Cold Chain: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationColdChain.purgeFailed', req.lang), 500, 'INVCOLD_005C_PURGE_FAILED', error));
    }
}

export {
    createInvestigationColdChain,
    getAllInvestigationColdChains,
    getInvestigationColdChainByCaseId,
    getInvestigationColdChainById,
    getInvestigationColdChains,
    purgeInvestigationColdChain,
    updateInvestigationColdChain
};
