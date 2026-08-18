import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationVaccineService,
    getAllNotificationVaccinesByNotificationService,
    getNotificationVaccineByIdService,
    getNotificationVaccinesByCaseIdService,
    getNotificationVaccinesByNotificationService
} from '../services/notificationVaccine.service';

// Create Notification Vaccine Controller
// Code: ESAVI-NOTIFVAC-001
const createNotificationVaccine = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationVaccineService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationVaccine.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-001: Error creating Notification Vaccine: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.createdFailed', req.lang), 500, 'NOTIFVAC_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Vaccines By Notification Controller
// Code: ESAVI-NOTIFVAC-002A
const getNotificationVaccinesByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationVaccinesByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationVaccine.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-002A: Error fetching Notification Vaccines by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.getFailed', req.lang), 500, 'NOTIFVAC_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Vaccines By Notification Controller - For Admin
// Code: ESAVI-NOTIFVAC-002B
const getAllNotificationVaccinesByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationVaccinesByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationVaccine.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-002B: Error fetching all Notification Vaccines by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.getFailed', req.lang), 500, 'NOTIFVAC_002B_FETCH_FAILED', error));
    }
}

// Get Notification Vaccine By ID Controller
// Code: ESAVI-NOTIFVAC-003
const getNotificationVaccineById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotificationVaccineByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationVaccine.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-003: Error fetching Notification Vaccine by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.getFailed', req.lang), 500, 'NOTIFVAC_003_FETCH_FAILED', error));
    }
}

// Get Notification Vaccines By Case ID Controller
// Code: ESAVI-NOTIFVAC-006
const getNotificationVaccinesByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const caseId = (req.params.caseId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationVaccinesByCaseIdService(
            caseId,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationVaccine.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-006: Error fetching Notification Vaccines by Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.getFailed', req.lang), 500, 'NOTIFVAC_006_FETCH_FAILED', error));
    }
}

export {
    createNotificationVaccine,
    getAllNotificationVaccinesByNotification,
    getNotificationVaccineById,
    getNotificationVaccinesByCaseId,
    getNotificationVaccinesByNotification
};
