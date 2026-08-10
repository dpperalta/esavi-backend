import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, NotifierListFilters } from '../types';
import {
    createNotifierService,
    getAllNotifiersService,
    getNotifierByIdService,
    getNotifiersService,
    setNotifierActivationService,
    updateNotifierService
} from '../services/notifier.service';

// The three query filters of 002A and 002B. Only what actually arrives travels to the service,
// so an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): NotifierListFilters => ({
    caseId: req.query.caseId as string | undefined,
    professionItemId: req.query.professionItemId as string | undefined,
    geoLocationId: req.query.geoLocationId as string | undefined
});

// Create Notifier Controller
// Code: ESAVI-NOTIFIER-001
const createNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotifierService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notifier.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-001: Error creating Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.createdFailed', req.lang), 500, 'NOTIFIER_001_CREATION_FAILED', error));
    }
}

// Get Notifiers Controller
// Code: ESAVI-NOTIFIER-002A
const getNotifiers = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotifiersService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-002A: Error fetching Notifiers: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.getFailedPlural', req.lang), 500, 'NOTIFIER_002A_FETCH_FAILED', error));
    }
}

// Get All Notifiers Controller - For Admin
// Code: ESAVI-NOTIFIER-002B
const getAllNotifiers = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotifiersService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-002B: Error fetching all Notifiers: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.getFailedPlural', req.lang), 500, 'NOTIFIER_002B_FETCH_FAILED', error));
    }
}

// Get Notifier By ID Controller
// Code: ESAVI-NOTIFIER-003
const getNotifierById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotifierByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-003: Error fetching Notifier by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.getFailed', req.lang), 500, 'NOTIFIER_003_FETCH_FAILED', error));
    }
}

// Update Notifier Controller
// Code: ESAVI-NOTIFIER-004
const updateNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateNotifierService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-004: Error updating Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.updatedFailed', req.lang), 500, 'NOTIFIER_004_UPDATE_FAILED', error));
    }
}

// Delete Notifier Controller - Soft delete
// Code: ESAVI-NOTIFIER-005A
const deleteNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotifierActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-005A: Error deleting Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.deletedFailed', req.lang), 500, 'NOTIFIER_005A_DELETE_FAILED', error));
    }
}

// Activate Notifier Controller - For SuperAdmin
// Code: ESAVI-NOTIFIER-005B
const activateNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotifierActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-005B: Error activating Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.activatedFailed', req.lang), 500, 'NOTIFIER_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createNotifier,
    getNotifiers,
    getAllNotifiers,
    getNotifierById,
    updateNotifier,
    deleteNotifier,
    activateNotifier
}
