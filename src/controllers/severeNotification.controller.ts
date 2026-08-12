import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createSevereNotificationService,
    getSevereNotificationByIdService
} from '../services/severeNotification.service';

// Create Severe Notification Controller
// Code: ESAVI-SEVNOT-001
const createSevereNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createSevereNotificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('severeNotification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SEVNOT-001: Error creating Severe Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('severeNotification.createdFailed', req.lang), 500, 'SEVNOT_001_CREATION_FAILED', error));
    }
}

// Get Severe Notification By ID Controller
// Code: ESAVI-SEVNOT-003
const getSevereNotificationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getSevereNotificationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('severeNotification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SEVNOT-003: Error fetching Severe Notification by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('severeNotification.getFailed', req.lang), 500, 'SEVNOT_003_FETCH_FAILED', error));
    }
}

export {
    createSevereNotification,
    getSevereNotificationById
}
