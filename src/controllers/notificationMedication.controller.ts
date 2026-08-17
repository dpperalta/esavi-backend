import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createNotificationMedicationService
} from '../services/notificationMedication.service';

// Create Notification Medication Controller
// Code: ESAVI-NOTIFMED-001
const createNotificationMedication = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationMedicationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationMedication.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFMED-001: Error creating Notification Medication: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationMedication.createdFailed', req.lang), 500, 'NOTIFMED_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationMedication
};
