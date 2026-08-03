import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage, canViewInactive } from '../helpers';
import { createGeoLocationService, getAllGeoLocationsService, getActiveGeoLocationsService, getGeoLocationByIdService, updateGeoLocationService, setGeoLocationActivationService } from '../services/geoLocation.service';


// Create Geographic Location Controller
// Code: ESAVI-GEOLOC-001
const createGeoLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const createdLocation = await createGeoLocationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('geoLocation.createdSuccess', req.lang),
            data: createdLocation
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-001: Error creating Geolocation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.createdFailed', req.lang), 500, 'GEOLOC_001_CREATION_FAILED', error));
    }
}

// Get Geographic Location Types Controller
// Code: ESAVI-GEOLOC-002
const getGeoLocations = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    const geoLevelId = req.query.geoLevelId ? (req.query.geoLevelId as string).trim() : undefined;
    const parentId = req.query.parentId ? (req.query.parentId as string).trim() : undefined;
    try {
        const data = canViewInactive(req.user) 
            ? await getAllGeoLocationsService( geoLevelId, parentId, limit,  offset ) 
            : await getActiveGeoLocationsService( geoLevelId, parentId, limit,  offset );
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLocation.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-002: Error fetching GeoLocations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.getFailedPlural', req.lang), 500, 'GEOLOC_002_FETCH_FAILED', error));
    }
}

// Get Geographic Location by ID Controller
// Code: ESAVI-GEOLOC-003
const getGeoLocationById = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        const data = await getGeoLocationByIdService(id, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLocation.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-003: Error fetching GeoLocation by Id: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.getFailed', req.lang), 500, 'GEOLOC_003_FETCH_FAILED', error));
    }
}

// Update Geographic Location by ID Controller
// Code: ESAVI-GEOLOC-004
const updateGeoLocation = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        const updatedLocation = await updateGeoLocationService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLocation.updatedSuccess', req.lang),
            data: updatedLocation
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-004: Error updating GeoLocation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.updatedFailed', req.lang), 500, 'GEOLOC_004_UPDATE_FAILED', error));
    }
}

// Soft delete Geographic Location by ID Controller
// Code: ESAVI-GEOLOC-005A
const deleteGeoLocation = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        await setGeoLocationActivationService( id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLocation.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-005A: Error deleting GeoLocation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.deletedFailed', req.lang), 500, 'GEOLOC_005A_DELETE_FAILED', error));
    }
        
}

// Activate Geographic Location Controller
// Code: ESAVI-GEOLOC-005B
const activateGeoLocation = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        await setGeoLocationActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLocation.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-GEOLOC-005B: Error activating GeoLocation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLocation.activatedFailed', req.lang), 500, 'GEOLOC_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createGeoLocation,
    getGeoLocations,
    getGeoLocationById,
    updateGeoLocation,
    deleteGeoLocation,
    activateGeoLocation
}