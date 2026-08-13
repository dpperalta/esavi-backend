import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNonSevereNotificationService,
    getNonSevereNotificationByCaseIdService,
    getNonSevereNotificationByIdService,
    updateNonSevereNotificationService
} from '../services/nonSevereNotification.service';

// Create Non Severe Notification Controller
// Code: ESAVI-NSEVNOT-001
const createNonSevereNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNonSevereNotificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('nonSevereNotification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NSEVNOT-001: Error creating Non Severe Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('nonSevereNotification.createdFailed', req.lang), 500, 'NSEVNOT_001_CREATION_FAILED', error));
    }
}

// Get Non Severe Notification By ID Controller
// Code: ESAVI-NSEVNOT-003
const getNonSevereNotificationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getNonSevereNotificationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('nonSevereNotification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NSEVNOT-003: Error fetching Non Severe Notification by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('nonSevereNotification.getFailed', req.lang), 500, 'NSEVNOT_003_FETCH_FAILED', error));
    }
}

// Get Non Severe Notification By Case ID Controller
// Code: ESAVI-NSEVNOT-006
const getNonSevereNotificationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getNonSevereNotificationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('nonSevereNotification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NSEVNOT-006: Error fetching Non Severe Notification by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('nonSevereNotification.getFailed', req.lang), 500, 'NSEVNOT_006_FETCH_FAILED', error));
    }
}

// Update Non Severe Notification Controller
// Code: ESAVI-NSEVNOT-004
const updateNonSevereNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateNonSevereNotificationService(
            id.toString().trim(),
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('nonSevereNotification.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NSEVNOT-004: Error updating Non Severe Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('nonSevereNotification.updatedFailed', req.lang), 500, 'NSEVNOT_004_UPDATE_FAILED', error));
    }
}

export {
    createNonSevereNotification,
    getNonSevereNotificationByCaseId,
    getNonSevereNotificationById,
    updateNonSevereNotification
};
