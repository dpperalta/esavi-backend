import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNotificationVaccineService } from '../services/notificationVaccine.service';

// Create Notification Vaccine Controller
// Code: ESAVI-NOTIFVAC-001
const createNotificationVaccine = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationVaccineService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationVaccine.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFVAC-001: Error creating Notification Vaccine: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationVaccine.createdFailed', req.lang), 500, 'NOTIFVAC_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationVaccine
};
