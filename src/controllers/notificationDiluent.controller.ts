import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationDiluentService,
    getAllNotificationDiluentsByVaccineService,
    getNotificationDiluentByIdService,
    getNotificationDiluentsByVaccineService
} from '../services/notificationDiluent.service';

// Create Notification Diluent Controller
// Code: ESAVI-NOTIFDIL-001
const createNotificationDiluent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationDiluentService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationDiluent.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-001: Error creating Notification Diluent: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.createdFailed', req.lang), 500, 'NOTIFDIL_001_CREATION_FAILED', error));
    }
}

// Get Active Notification Diluents By Vaccine Controller
// Code: ESAVI-NOTIFDIL-002A
const getNotificationDiluentsByVaccine = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationDiluentsByVaccineService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationDiluent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-002A: Error fetching Notification Diluents by Vaccine: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.getFailed', req.lang), 500, 'NOTIFDIL_002A_FETCH_FAILED', error));
    }
}

// Get All Notification Diluents By Vaccine Controller - For Admin
// Code: ESAVI-NOTIFDIL-002B
const getAllNotificationDiluentsByVaccine = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationDiluentsByVaccineService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationDiluent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-002B: Error fetching all Notification Diluents by Vaccine: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.getFailed', req.lang), 500, 'NOTIFDIL_002B_FETCH_FAILED', error));
    }
}

// Get Notification Diluent By ID Controller
// Code: ESAVI-NOTIFDIL-003
const getNotificationDiluentById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getNotificationDiluentByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationDiluent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-003: Error fetching Notification Diluent by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.getFailed', req.lang), 500, 'NOTIFDIL_003_FETCH_FAILED', error));
    }
}

export {
    createNotificationDiluent,
    getAllNotificationDiluentsByVaccine,
    getNotificationDiluentById,
    getNotificationDiluentsByVaccine
};
