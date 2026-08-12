import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createSevereNotificationService } from '../services/severeNotification.service';

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

export {
    createSevereNotification
}
