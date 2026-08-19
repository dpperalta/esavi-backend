import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationPregnancyService,
    getNotificationPregnancyByIdService,
    getNotificationPregnancyByNotificationService
} from '../services/notificationPregnancy.service';

// Create Notification Pregnancy Controller
// Code: ESAVI-NOTIFPRG-001
const createNotificationPregnancy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationPregnancyService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationPregnancy.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFPRG-001: Error creating Notification Pregnancy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancy.createdFailed', req.lang), 500, 'NOTIFPRG_001_CREATION_FAILED', error));
    }
}

// Get Notification Pregnancy By ID Controller
// Code: ESAVI-NOTIFPRG-003
const getNotificationPregnancyById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotificationPregnancyByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancy.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFPRG-003: Error fetching Notification Pregnancy by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancy.getFailed', req.lang), 500, 'NOTIFPRG_003_FETCH_FAILED', error));
    }
}

// Get Notification Pregnancy By Notification Controller
// Code: ESAVI-NOTIFPRG-006
const getNotificationPregnancyByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const notificationId = (req.params.notificationId).toString().trim();
    try {
        const data = await getNotificationPregnancyByNotificationService(
            notificationId,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationPregnancy.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFPRG-006: Error fetching Notification Pregnancy by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancy.getFailed', req.lang), 500, 'NOTIFPRG_006_FETCH_FAILED', error));
    }
}

export {
    createNotificationPregnancy,
    getNotificationPregnancyById,
    getNotificationPregnancyByNotification
};
