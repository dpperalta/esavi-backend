import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationMedicationService,
    getAllNotificationMedicationsByNotificationService,
    getNotificationMedicationByIdService,
    getNotificationMedicationsByCaseIdService,
    getNotificationMedicationsByNotificationService
} from '../services/notificationMedication.service';

// Create Notification Medication Controller
// Code: ESAVI-NOTIFMED-001
const createNotificationMedication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationMedicationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationMedication.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-001: Error creating Notification Medication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.createdFailed', req.lang), 500, 'NOTIFMED_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Medications By Notification Controller
// Code: ESAVI-NOTIFMED-002A
const getNotificationMedicationsByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationMedicationsByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-002A: Error fetching Notification Medications by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.getFailed', req.lang), 500, 'NOTIFMED_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Medications By Notification Controller - For Admin
// Code: ESAVI-NOTIFMED-002B
const getAllNotificationMedicationsByNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationMedicationsByNotificationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-002B: Error fetching all Notification Medications by Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.getFailed', req.lang), 500, 'NOTIFMED_002B_FETCH_FAILED', error));
    }
}

// Get Notification Medication By ID Controller
// Code: ESAVI-NOTIFMED-003
const getNotificationMedicationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getNotificationMedicationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-003: Error fetching Notification Medication by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.getFailed', req.lang), 500, 'NOTIFMED_003_FETCH_FAILED', error));
    }
}

// Get Notification Medications By Case ID Controller
// Code: ESAVI-NOTIFMED-006
const getNotificationMedicationsByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationMedicationsByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationMedication.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-006: Error fetching Notification Medications by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.getFailed', req.lang), 500, 'NOTIFMED_006_FETCH_FAILED', error));
    }
}

export {
    createNotificationMedication,
    getNotificationMedicationsByNotification,
    getAllNotificationMedicationsByNotification,
    getNotificationMedicationById,
    getNotificationMedicationsByCaseId
};
