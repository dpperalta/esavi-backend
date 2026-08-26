import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationCommunityListFilters } from '../types';
import {
    createInvestigationCommunityService,
    getAllInvestigationCommunitiesService,
    getInvestigationCommunitiesService,
    getInvestigationCommunityByCaseIdService,
    getInvestigationCommunityByIdService,
    purgeInvestigationCommunityService,
    updateInvestigationCommunityService
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

// Get Investigation Community By ID Controller
// Code: ESAVI-INVCOMM-003
// canViewInactive is what lets a SUPERADMIN read the community record of a retired investigation:
// the entity has no state of its own, so the predicate is applied over the visibility it inherits
const getInvestigationCommunityById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationCommunityByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-003: Error fetching Investigation Community: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.getFailed', req.lang), 500, 'INVCOMM_003_FETCH_FAILED', error));
    }
}

// Get Investigation Community By Case ID Controller
// Code: ESAVI-INVCOMM-006
// canViewInactive travels for the same reason as in the 003: the entity has no state of its own, so
// the predicate is applied over the visibility it inherits, and here it opens the second hop of the
// chain as well — a SUPERADMIN reaches the community record of a retired investigation of a live case
const getInvestigationCommunityByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getInvestigationCommunityByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-006: Error fetching Investigation Community by case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.getFailed', req.lang), 500, 'INVCOMM_006_FETCH_FAILED', error));
    }
}

// Update Investigation Community Controller
// Code: ESAVI-INVCOMM-004
// canViewInactive travels for the same reason as in the 003: a community record whose investigation
// is retired answers 404 to USER and ADMIN, and only a SUPERADMIN can still write on it
const updateInvestigationCommunity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateInvestigationCommunityService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-004: Error updating Investigation Community: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.updatedFailed', req.lang), 500, 'INVCOMM_004_UPDATE_FAILED', error));
    }
}

// Purge Investigation Community Controller - Physical delete, for SuperAdmin
// Code: ESAVI-INVCOMM-005C
// Responds without `data`: the row no longer exists, so there is nothing to return. It is also the
// only operation of the entity that writes no appDetails entry, which CONVENTIONS.md declares
// correct — the row is destroyed in the same transaction any audit would have been written into
const purgeInvestigationCommunity = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        await purgeInvestigationCommunityService(id.toString().trim(), req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationCommunity.purgeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVCOMM-005C: Error purging Investigation Community: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationCommunity.purgeFailed', req.lang), 500, 'INVCOMM_005C_PURGE_FAILED', error));
    }
}

export {
    createInvestigationCommunity,
    getAllInvestigationCommunities,
    getInvestigationCommunities,
    getInvestigationCommunityByCaseId,
    getInvestigationCommunityById,
    purgeInvestigationCommunity,
    updateInvestigationCommunity
}
