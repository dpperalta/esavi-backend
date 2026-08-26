import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, FinalClassificationListFilters } from '../types';
import {
    createFinalClassificationService,
    getAllFinalClassificationsService,
    getFinalClassificationByCaseIdService,
    getFinalClassificationByIdService,
    getFinalClassificationsService,
    setFinalClassificationActivationService,
    updateFinalClassificationService
} from '../services/finalClassification.service';

// The single query filter of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): FinalClassificationListFilters => ({
    caseId: req.query.caseId as string | undefined
});

// Create Final Classification Controller
// Code: ESAVI-FINCLASS-001
const createFinalClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createFinalClassificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('finalClassification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-001: Error creating Final Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.createdFailed', req.lang), 500, 'FINCLASS_001_CREATION_FAILED', error));
    }
}

// Get Final Classifications Controller
// Code: ESAVI-FINCLASS-002A
const getFinalClassifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getFinalClassificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-002A: Error fetching Final Classifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.getFailedPlural', req.lang), 500, 'FINCLASS_002A_FETCH_FAILED', error));
    }
}

// Get All Final Classifications Controller - For Admin
// Code: ESAVI-FINCLASS-002B
// The admin variant of the dual listing. It is a controller of its own and not a branch of the
// 002A, so each of the two operation codes lives in exactly one place
const getAllFinalClassifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllFinalClassificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-002B: Error fetching all Final Classifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.getFailedPlural', req.lang), 500, 'FINCLASS_002B_FETCH_FAILED', error));
    }
}

// Get Final Classification By ID Controller
// Code: ESAVI-FINCLASS-003
// canViewInactive is what lets a SUPERADMIN read a retired verdict: the entity has a state of its
// own, so the row can be inactive while its case is still alive
const getFinalClassificationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getFinalClassificationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-003: Error fetching Final Classification by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.getFailed', req.lang), 500, 'FINCLASS_003_FETCH_FAILED', error));
    }
}

// Get Final Classification By Case ID Controller
// Code: ESAVI-FINCLASS-006
const getFinalClassificationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getFinalClassificationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-006: Error fetching Final Classification by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.getFailed', req.lang), 500, 'FINCLASS_006_FETCH_FAILED', error));
    }
}

// Update Final Classification Controller
// Code: ESAVI-FINCLASS-004
// canViewInactive travels for the same reason as in the 003: a retired verdict answers 404 to
// USER and ADMIN, and only a SUPERADMIN reaches it
const updateFinalClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateFinalClassificationService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-004: Error updating Final Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.updatedFailed', req.lang), 500, 'FINCLASS_004_UPDATE_FAILED', error));
    }
}

// Delete Final Classification Controller - Soft delete
// Code: ESAVI-FINCLASS-005A
const deleteFinalClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await setFinalClassificationActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.deletedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-005A: Error deleting Final Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.deletedFailed', req.lang), 500, 'FINCLASS_005A_DELETE_FAILED', error));
    }
}

// Activate Final Classification Controller - For SuperAdmin
// Code: ESAVI-FINCLASS-005B
const activateFinalClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await setFinalClassificationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('finalClassification.activatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-FINCLASS-005B: Error activating Final Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('finalClassification.activatedFailed', req.lang), 500, 'FINCLASS_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createFinalClassification,
    getFinalClassifications,
    getAllFinalClassifications,
    getFinalClassificationById,
    getFinalClassificationByCaseId,
    updateFinalClassification,
    deleteFinalClassification,
    activateFinalClassification
}
