import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createNotificationDiluentService,
    getNotificationDiluentsByVaccineService
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

// Get Active Notification Diluents By Vaccine Controller
// Code: ESAVI-NOTIFDIL-002A
const getNotificationDiluentsByVaccine = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotificationDiluentsByVaccineService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('notificationDiluent.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFDIL-002A: Error fetching Notification Diluents by Vaccine: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notificationDiluent.getFailed', req.lang), 500, 'NOTIFDIL_002A_FETCH_FAILED', error));
    }
}

export {
    createNotificationDiluent,
    getNotificationDiluentsByVaccine
};
