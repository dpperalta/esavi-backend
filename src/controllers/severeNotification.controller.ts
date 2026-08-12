import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createSevereNotificationService,
    getSevereNotificationByCaseIdService,
    getSevereNotificationByIdService,
    updateSevereNotificationService
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

// Get Severe Notification By Case ID Controller
// Code: ESAVI-SEVNOT-006
const getSevereNotificationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getSevereNotificationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('severeNotification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SEVNOT-006: Error fetching Severe Notification by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('severeNotification.getFailed', req.lang), 500, 'SEVNOT_006_FETCH_FAILED', error));
    }
}

// Update Severe Notification Controller
// Code: ESAVI-SEVNOT-004
const updateSevereNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateSevereNotificationService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('severeNotification.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SEVNOT-004: Error updating Severe Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('severeNotification.updatedFailed', req.lang), 500, 'SEVNOT_004_UPDATE_FAILED', error));
    }
}

export {
    createSevereNotification,
    getSevereNotificationById,
    getSevereNotificationByCaseId,
    updateSevereNotification
}
