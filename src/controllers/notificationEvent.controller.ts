import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationEventService,
    getAllNotificationEventsByNotificationService,
    getNotificationEventByIdService,
    getNotificationEventsByCaseIdService,
    getNotificationEventsByNotificationService,
    setNotificationEventActivationService,
    updateNotificationEventService
} from '../services/notificationEvent.service';

// Create Notification Event Controller
// Code: ESAVI-NOTIFEVT-001
const createNotificationEvent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationEventService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationEvent.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-001: Error creating Notification Event: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.createdFailed', req.lang), 500, 'NOTIFEVT_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Events By Notification Controller
// Code: ESAVI-NOTIFEVT-002A
const getNotificationEventsByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationEventsByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-002A: Error fetching Notification Events by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.getFailed', req.lang), 500, 'NOTIFEVT_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Events By Notification Controller - For Admin
// Code: ESAVI-NOTIFEVT-002B
const getAllNotificationEventsByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationEventsByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-002B: Error fetching all Notification Events by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.getFailed', req.lang), 500, 'NOTIFEVT_002B_FETCH_FAILED', error));
    }
}

// Get Notification Event By ID Controller
// Code: ESAVI-NOTIFEVT-003
const getNotificationEventById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getNotificationEventByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-003: Error fetching Notification Event by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.getFailed', req.lang), 500, 'NOTIFEVT_003_FETCH_FAILED', error));
    }
}

// Get Notification Events By Case ID Controller
// Code: ESAVI-NOTIFEVT-006
const getNotificationEventsByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationEventsByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-006: Error fetching Notification Events by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.getFailed', req.lang), 500, 'NOTIFEVT_006_FETCH_FAILED', error));
    }
}

// Update Notification Event Controller
// Code: ESAVI-NOTIFEVT-004
const updateNotificationEvent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateNotificationEventService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-004: Error updating Notification Event: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.updatedFailed', req.lang), 500, 'NOTIFEVT_004_UPDATE_FAILED', error));
    }
}

// Delete Notification Event Controller
// Code: ESAVI-NOTIFEVT-005A
const deleteNotificationEvent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationEventActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-005A: Error deleting Notification Event: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.deletedFailed', req.lang), 500, 'NOTIFEVT_005A_DELETE_FAILED', error));
    }
}

// Activate Notification Event Controller - For SuperAdmin
// Code: ESAVI-NOTIFEVT-005B
const activateNotificationEvent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationEventActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationEvent.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-005B: Error activating Notification Event: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.activatedFailed', req.lang), 500, 'NOTIFEVT_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createNotificationEvent,
    getNotificationEventsByNotification,
    getAllNotificationEventsByNotification,
    getNotificationEventById,
    getNotificationEventsByCaseId,
    updateNotificationEvent,
    deleteNotificationEvent,
    activateNotificationEvent
};
