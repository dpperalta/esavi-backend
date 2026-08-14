import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNotificationEventService } from '../services/notificationEvent.service';

// Create Notification Event Controller
// Code: ESAVI-NOTIFEVT-001
const createNotificationEvent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationEventService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationEvent.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFEVT-001: Error creating Notification Event: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationEvent.createdFailed', req.lang), 500, 'NOTIFEVT_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationEvent
};
