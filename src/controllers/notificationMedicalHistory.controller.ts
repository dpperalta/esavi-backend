import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationMedicalHistoryService,
    getAllNotificationMedicalHistoriesByNotificationService,
    getNotificationMedicalHistoriesByNotificationService
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

export {
    createNotificationMedicalHistory,
    getNotificationMedicalHistoriesByNotification,
    getAllNotificationMedicalHistoriesByNotification
};
