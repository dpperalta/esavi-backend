import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationPregnancyComplicationService,
    getAllNotificationPregnancyComplicationsByPregnancyService,
    getNotificationPregnancyComplicationByIdService,
    getNotificationPregnancyComplicationsByPregnancyService,
    setNotificationPregnancyComplicationActivationService,
    updateNotificationPregnancyComplicationService
} from '../services/notificationPregnancyComplication.service';

// Create Notification Pregnancy Complication Controller
// Code: ESAVI-PREGCOMP-001
const createNotificationPregnancyComplication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationPregnancyComplicationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-001: Error creating Notification Pregnancy Complication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.createdFailed', req.lang), 500, 'PREGCOMP_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Pregnancy Complications By Pregnancy Controller
// Code: ESAVI-PREGCOMP-002A
const getNotificationPregnancyComplicationsByPregnancy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationPregnancyComplicationsByPregnancyService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-002A: Error fetching Notification Pregnancy Complications by Pregnancy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.getFailed', req.lang), 500, 'PREGCOMP_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Pregnancy Complications By Pregnancy Controller - For Admin
// Code: ESAVI-PREGCOMP-002B
const getAllNotificationPregnancyComplicationsByPregnancy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationPregnancyComplicationsByPregnancyService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-002B: Error fetching all Notification Pregnancy Complications by Pregnancy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.getFailed', req.lang), 500, 'PREGCOMP_002B_FETCH_FAILED', error));
    }
}

// Get Notification Pregnancy Complication By ID Controller
// Code: ESAVI-PREGCOMP-003
const getNotificationPregnancyComplicationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotificationPregnancyComplicationByIdService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-003: Error fetching Notification Pregnancy Complication by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.getFailed', req.lang), 500, 'PREGCOMP_003_FETCH_FAILED', error));
    }
}

// Update Notification Pregnancy Complication Controller
// Code: ESAVI-PREGCOMP-004
const updateNotificationPregnancyComplication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateNotificationPregnancyComplicationService(
            id,
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-004: Error updating Notification Pregnancy Complication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.updatedFailed', req.lang), 500, 'PREGCOMP_004_UPDATE_FAILED', error));
    }
}

// Delete Notification Pregnancy Complication Controller - Soft delete
// Code: ESAVI-PREGCOMP-005A
const deleteNotificationPregnancyComplication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await setNotificationPregnancyComplicationActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.deletedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-005A: Error deleting Notification Pregnancy Complication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.deletedFailed', req.lang), 500, 'PREGCOMP_005A_DELETION_FAILED', error));
    }
}

// Activate Notification Pregnancy Complication Controller - For SuperAdmin
// Code: ESAVI-PREGCOMP-005B
const activateNotificationPregnancyComplication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await setNotificationPregnancyComplicationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.activatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-005B: Error activating Notification Pregnancy Complication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.activatedFailed', req.lang), 500, 'PREGCOMP_005B_ACTIVATION_FAILED', error));
    }
}

export {
    activateNotificationPregnancyComplication,
    createNotificationPregnancyComplication,
    deleteNotificationPregnancyComplication,
    getAllNotificationPregnancyComplicationsByPregnancy,
    getNotificationPregnancyComplicationById,
    getNotificationPregnancyComplicationsByPregnancy,
    updateNotificationPregnancyComplication
};
