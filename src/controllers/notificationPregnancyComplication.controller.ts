import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createNotificationPregnancyComplicationService
} from '../services/notificationPregnancyComplication.service';

// Create Notification Pregnancy Complication Controller
// Code: ESAVI-PREGCOMP-001
const createNotificationPregnancyComplication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationPregnancyComplicationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationPregnancyComplication.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PREGCOMP-001: Error creating Notification Pregnancy Complication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationPregnancyComplication.createdFailed', req.lang), 500, 'PREGCOMP_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationPregnancyComplication
};
