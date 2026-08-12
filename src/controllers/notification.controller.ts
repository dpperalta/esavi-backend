import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNotificationService } from '../services/notification.service';

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

export {
    createNotification
}
