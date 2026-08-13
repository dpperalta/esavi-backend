import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNonSevereNotificationService } from '../services/nonSevereNotification.service';

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

export {
    createNonSevereNotification
};
