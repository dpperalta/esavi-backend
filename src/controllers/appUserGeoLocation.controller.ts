import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createAppUserGeoLocationService } from '../services/appUserGeoLocation.service';

// Create App User Geo Location Controller
// Code: ESAVI-USERGEO-001
const createAppUserGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        // A new pair is a 201; an existing but closed pair is reactivated and answers 200,
        // so the client tells creation from reactivation without comparing createdAt
        const { assignment, created } = await createAppUserGeoLocationService(req.body, req.user, req.lang);
        return res.status(created ? 201 : 200).json({
            ok: true,
            message: getMessage(created ? 'appUserGeoLocation.createSuccess' : 'appUserGeoLocation.reactivateSuccess', req.lang),
            data: assignment
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-001: Error creating App User Geo Location: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.createdFailed', req.lang), 500, 'USERGEO_001_CREATION_FAILED', error));
    }
}

export {
    createAppUserGeoLocation
}
