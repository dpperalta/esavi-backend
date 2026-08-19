import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNotificationPregnancyService } from '../services/notificationPregnancy.service';

// Create Notification Pregnancy Controller
// Code: ESAVI-NOTIFPRG-001
const createNotificationPregnancy = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationPregnancyService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationPregnancy.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFPRG-001: Error creating Notification Pregnancy: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancy.createdFailed', req.lang), 500, 'NOTIFPRG_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationPregnancy
};
