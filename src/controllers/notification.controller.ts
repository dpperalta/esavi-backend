import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, NotificationListFilters } from '../types';
import { NotificationType } from '../constants/notification.constants';
import {
    createNotificationService,
    getAllNotificationsService,
    getNotificationByCaseIdService,
    getNotificationByIdService,
    getNotificationsService,
    purgeNotificationService,
    setNotificationActivationService,
    updateNotificationService
} from '../services/notification.service';

// The four query filters of 002A and 002B. Only what actually arrives travels to the service, so
// an absent filter never turns into an `undefined` in the where clause. requestInvestigation
// comes off the query string, where everything is text: the validator already restricted it to a
// boolean, so comparing against 'true' is enough to read it. notificationType is cast and not
// re-checked: the validator already restricted it to the ENUM
const listFilters = (req: Request): NotificationListFilters => ({
    caseId: req.query.caseId as string | undefined,
    notificationType: req.query.notificationType as NotificationType | undefined,
    requestInvestigation: req.query.requestInvestigation !== undefined
        ? String(req.query.requestInvestigation) === 'true' : undefined,
    outcomeItemId: req.query.outcomeItemId as string | undefined
});

// Create Notification Controller
// Code: ESAVI-NOTIFCN-001
const createNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-001: Error creating Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.createdFailed', req.lang), 500, 'NOTIFCN_001_CREATION_FAILED', error));
    }
}

// Get Notifications Controller
// Code: ESAVI-NOTIFCN-002A
const getNotifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-002A: Error fetching Notifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.getFailedPlural', req.lang), 500, 'NOTIFCN_002A_FETCH_FAILED', error));
    }
}

// Get All Notifications Controller - For Admin
// Code: ESAVI-NOTIFCN-002B
const getAllNotifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-002B: Error fetching Notifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.getFailedPlural', req.lang), 500, 'NOTIFCN_002B_FETCH_FAILED', error));
    }
}

// Get Notification By ID Controller
// Code: ESAVI-NOTIFCN-003
const getNotificationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getNotificationByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-003: Error fetching Notification by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.getFailed', req.lang), 500, 'NOTIFCN_003_FETCH_FAILED', error));
    }
}

// Get Notification By Case ID Controller
// Code: ESAVI-NOTIFCN-006
const getNotificationByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { caseId } = req.params;
    try {
        const data = await getNotificationByCaseIdService(
            caseId.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-006: Error fetching Notification by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.getFailed', req.lang), 500, 'NOTIFCN_006_FETCH_FAILED', error));
    }
}

// Update Notification Controller
// Code: ESAVI-NOTIFCN-004
const updateNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateNotificationService(id.toString().trim(), req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-004: Error updating Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.updatedFailed', req.lang), 500, 'NOTIFCN_004_UPDATE_FAILED', error));
    }
}

// Delete Notification Controller - Soft delete
// Code: ESAVI-NOTIFCN-005A
const deleteNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-005A: Error deleting Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.deletedFailed', req.lang), 500, 'NOTIFCN_005A_DELETE_FAILED', error));
    }
}

// Activate Notification Controller - For SuperAdmin
// Code: ESAVI-NOTIFCN-005B
const activateNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setNotificationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-005B: Error activating Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.activatedFailed', req.lang), 500, 'NOTIFCN_005B_ACTIVATION_FAILED', error));
    }
}

// Purge Notification Controller - Physical delete, for SuperAdmin
// Code: ESAVI-NOTIFCN-005C
const purgeNotification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await purgeNotificationService(id, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('notification.purgeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFCN-005C: Error purging Notification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notification.purgeFailed', req.lang), 500, 'NOTIFCN_005C_PURGE_FAILED', error));
    }
}

export {
    createNotification,
    getNotifications,
    getAllNotifications,
    getNotificationById,
    getNotificationByCaseId,
    updateNotification,
    deleteNotification,
    activateNotification,
    purgeNotification
}
