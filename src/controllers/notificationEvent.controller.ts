import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationEventService,
    getAllNotificationEventsByNotificationService,
    getNotificationEventByIdService,
    getNotificationEventsByNotificationService
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

export {
    createNotificationEvent,
    getNotificationEventsByNotification,
    getAllNotificationEventsByNotification,
    getNotificationEventById
};
