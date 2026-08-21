import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationListFilters } from '../types';
import {
    createInvestigationService,
    getAllInvestigationsService,
    getInvestigationByCaseIdService,
    getInvestigationByIdService,
    getInvestigationsService,
    purgeInvestigationService,
    setInvestigationActivationService,
    updateInvestigationService
} from '../services/investigation.service';

// The four query filters of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationListFilters => ({
    caseId: req.query.caseId as string | undefined,
    statusItemId: req.query.statusItemId as string | undefined,
    vaccinationHealthFacilityId: req.query.vaccinationHealthFacilityId as string | undefined,
    vaccinationGeoLocationId: req.query.vaccinationGeoLocationId as string | undefined
});

// Create Investigation Controller
// Code: ESAVI-INVESTGN-001
const createInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigation.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-001: Error creating Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.createdFailed', req.lang), 500, 'INVESTGN_001_CREATION_FAILED', error));
    }
}

// Get Investigations Controller
// Code: ESAVI-INVESTGN-002A
const getInvestigations = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-002A: Error fetching Investigations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.getFailedPlural', req.lang), 500, 'INVESTGN_002A_FETCH_FAILED', error));
    }
}

// Get All Investigations Controller - For Admin
// Code: ESAVI-INVESTGN-002B
const getAllInvestigations = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-002B: Error fetching all Investigations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.getFailedPlural', req.lang), 500, 'INVESTGN_002B_FETCH_FAILED', error));
    }
}

// Get Investigation by ID Controller
// Code: ESAVI-INVESTGN-003
const getInvestigationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-003: Error fetching Investigation by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.getFailed', req.lang), 500, 'INVESTGN_003_FETCH_FAILED', error));
    }
}

// Get Investigation by Case Controller
// Code: ESAVI-INVESTGN-006
const getInvestigationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getInvestigationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-006: Error fetching Investigation by Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.getFailed', req.lang), 500, 'INVESTGN_006_FETCH_FAILED', error));
    }
}

// Update Investigation Controller
// Code: ESAVI-INVESTGN-004
const updateInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateInvestigationService(id.toString().trim(), req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-004: Error updating Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.updatedFailed', req.lang), 500, 'INVESTGN_004_UPDATE_FAILED', error));
    }
}

// Soft delete Investigation Controller
// Code: ESAVI-INVESTGN-005A
const deleteInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setInvestigationActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-005A: Error deleting Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.deletedFailed', req.lang), 500, 'INVESTGN_005A_DELETE_FAILED', error));
    }
}

// Activate Investigation Controller - For SuperAdmin
// Code: ESAVI-INVESTGN-005B
const activateInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setInvestigationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-005B: Error activating Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.activatedFailed', req.lang), 500, 'INVESTGN_005B_ACTIVATION_FAILED', error));
    }
}

// Purge Investigation Controller - Physical delete, for SuperAdmin
// Code: ESAVI-INVESTGN-005C
const purgeInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await purgeInvestigationService(id, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigation.purgeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVESTGN-005C: Error purging Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigation.purgeFailed', req.lang), 500, 'INVESTGN_005C_PURGE_FAILED', error));
    }
}

export {
    createInvestigation,
    getInvestigations,
    getAllInvestigations,
    getInvestigationById,
    getInvestigationByCaseId,
    updateInvestigation,
    deleteInvestigation,
    activateInvestigation,
    purgeInvestigation
}
