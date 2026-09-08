import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createNotificationMedicalHistoryService
} from '../services/notificationMedicalHistory.service';

// Create Notification Medical History Controller
// Code: ESAVI-MEDHIST-001
const createNotificationMedicalHistory = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationMedicalHistoryService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationMedicalHistory.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDHIST-001: Error creating Notification Medical History: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedicalHistory.createdFailed', req.lang), 500, 'MEDHIST_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationMedicalHistory
};
