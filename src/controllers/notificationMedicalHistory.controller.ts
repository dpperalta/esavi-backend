import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationMedicalHistoryService,
    getAllNotificationMedicalHistoriesByNotificationService,
    getNotificationMedicalHistoriesByCaseIdService,
    getNotificationMedicalHistoriesByNotificationService,
    getNotificationMedicalHistoryByIdService,
    purgeNotificationMedicalHistoryService,
    setNotificationMedicalHistoryActivationService,
    updateNotificationMedicalHistoryService
} from '../services/notificationMedicalHistory.service';

// Create Notification Medical History Controller
// Code: ESAVI-MEDHIST-001
const createNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationMedicalHistoryService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-001: Error creating Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.createdFailed', req.lang), 500, 'MEDHIST_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Medical Histories By Notification Controller
// Code: ESAVI-MEDHIST-002A
const getNotificationMedicalHistoriesByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationMedicalHistoriesByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-002A: Error fetching Notification Medical Histories by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.getFailed', req.lang), 500, 'MEDHIST_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Medical Histories By Notification Controller - For Admin
// Code: ESAVI-MEDHIST-002B
const getAllNotificationMedicalHistoriesByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationMedicalHistoriesByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-002B: Error fetching all Notification Medical Histories by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.getFailed', req.lang), 500, 'MEDHIST_002B_FETCH_FAILED', error));
    }
}

// Get Notification Medical Histories By Case ID Controller
// Code: ESAVI-MEDHIST-006
const getNotificationMedicalHistoriesByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const caseId = (req.params.caseId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationMedicalHistoriesByCaseIdService(
            caseId,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-006: Error fetching Notification Medical Histories by Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.getFailed', req.lang), 500, 'MEDHIST_006_FETCH_FAILED', error));
    }
}

// Get Notification Medical History By ID Controller
// Code: ESAVI-MEDHIST-003
const getNotificationMedicalHistoryById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotificationMedicalHistoryByIdService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-003: Error fetching Notification Medical History by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.getFailed', req.lang), 500, 'MEDHIST_003_FETCH_FAILED', error));
    }
}

// Update Notification Medical History Controller
// Code: ESAVI-MEDHIST-004
const updateNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateNotificationMedicalHistoryService(
            id,
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-004: Error updating Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.updatedFailed', req.lang), 500, 'MEDHIST_004_UPDATE_FAILED', error));
    }
}

// Delete Notification Medical History Controller
// Code: ESAVI-MEDHIST-005A
const deleteNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationMedicalHistoryActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-005A: Error deleting Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.deletedFailed', req.lang), 500, 'MEDHIST_005A_DELETE_FAILED', error));
    }
}
// Activate Notification Medical History Controller - For SuperAdmin
// Code: ESAVI-MEDHIST-005B
const activateNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationMedicalHistoryActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-005B: Error activating Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.activatedFailed', req.lang), 500, 'MEDHIST_005B_ACTIVATION_FAILED', error));
    }
}
// Purging Notification Medical History Controller - For SuperAdmin
// Code: ESAVI-MEDHIST-005C
const purgeNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await purgeNotificationMedicalHistoryService(id, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.purgeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-005C: Error purging Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.purgeFailed', req.lang), 500, 'MEDHIST_005C_PURGE_FAILED', error));
    }
}

export {
    createNotificationMedicalHistory,
    getNotificationMedicalHistoriesByNotification,
    getAllNotificationMedicalHistoriesByNotification,
    getNotificationMedicalHistoryById,
    getNotificationMedicalHistoriesByCaseId,
    updateNotificationMedicalHistory,
    deleteNotificationMedicalHistory,
    activateNotificationMedicalHistory,
    purgeNotificationMedicalHistory
};
