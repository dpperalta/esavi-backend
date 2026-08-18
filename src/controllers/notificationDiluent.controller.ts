import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createNotificationDiluentService
} from '../services/notificationDiluent.service';

// Create Notification Diluent Controller
// Code: ESAVI-NOTIFDIL-001
const createNotificationDiluent = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotificationDiluentService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notificationDiluent.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-001: Error creating Notification Diluent: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.createdFailed', req.lang), 500, 'NOTIFDIL_001_CREATION_FAILED', error));
    }
}

export {
    createNotificationDiluent
};
