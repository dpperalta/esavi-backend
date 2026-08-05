import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createAppUserGeoLocationService,
    getAppUserGeoLocationsByUserService,
    getAllAppUserGeoLocationsByUserService,
    getAppUserGeoLocationByIdService,
    updateAppUserGeoLocationService,
    setAppUserGeoLocationActivationService,
    reassignAppUserGeoLocationService
} from '../services/appUserGeoLocation.service';

// The `current` default is not the same on both listings, so it is resolved per endpoint
// and an explicit ?current= always wins over it
const resolveCurrent = (value: unknown, fallback: boolean): boolean =>
    value === undefined ? fallback : value === 'true';

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

// Get App User Geo Locations By User Controller
// Code: ESAVI-USERGEO-002A
const getAppUserGeoLocationsByUser = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const userId = (req.params.userId).toString().trim();
    const current = resolveCurrent(req.query.current, true);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAppUserGeoLocationsByUserService(userId, req.lang, current, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-002A: Error getting App User Geo Locations by userId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.fetchFailed', req.lang), 500, 'USERGEO_002A_FETCH_FAILED', error));
    }
}

// Get All App User Geo Locations By User Controller - For Admin
// Code: ESAVI-USERGEO-002B
const getAllAppUserGeoLocationsByUser = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const userId = (req.params.userId).toString().trim();
    const current = resolveCurrent(req.query.current, false);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllAppUserGeoLocationsByUserService(userId, req.lang, current, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-002B: Error getting all App User Geo Locations by userId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.fetchFailed', req.lang), 500, 'USERGEO_002B_FETCH_FAILED', error));
    }
}

// Get App User Geo Location By ID Controller
// Code: ESAVI-USERGEO-003
const getAppUserGeoLocationById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getAppUserGeoLocationByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-003: Error getting App User Geo Location by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.fetchFailed', req.lang), 500, 'USERGEO_003_FETCH_FAILED', error));
    }
}

// Update App User Geo Location Controller
// Code: ESAVI-USERGEO-004
const updateAppUserGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateAppUserGeoLocationService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.updateSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-004: Error updating App User Geo Location: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.updatedFailed', req.lang), 500, 'USERGEO_004_UPDATE_FAILED', error));
    }
}

// Delete App User Geo Location Controller
// Code: ESAVI-USERGEO-005A
const deleteAppUserGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppUserGeoLocationActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.deleteSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-005A: Error deleting App User Geo Location: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.updatedFailed', req.lang), 500, 'USERGEO_005A_DELETE_FAILED', error));
    }
}

// Activate App User Geo Location Controller - For SuperAdmin
// Code: ESAVI-USERGEO-005B
const activateAppUserGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppUserGeoLocationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.activateSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-005B: Error activating App User Geo Location: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.updatedFailed', req.lang), 500, 'USERGEO_005B_ACTIVATION_FAILED', error));
    }
}

// Reassign App User Geo Location Controller
// Code: ESAVI-USERGEO-006
const reassignAppUserGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await reassignAppUserGeoLocationService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserGeoLocation.reassignSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERGEO-006: Error reassigning App User Geo Location: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserGeoLocation.reassignFailed', req.lang), 500, 'USERGEO_006_REASSIGN_FAILED', error));
    }
}

export {
    createAppUserGeoLocation,
    getAppUserGeoLocationsByUser,
    getAllAppUserGeoLocationsByUser,
    getAppUserGeoLocationById,
    updateAppUserGeoLocation,
    deleteAppUserGeoLocation,
    activateAppUserGeoLocation,
    reassignAppUserGeoLocation
}
