import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from "../helpers";
import { AuthUser } from '../types';
import {
    createHealthFacilityService,
    getAllHealthFacilitiesByGeoLocationService,
    getHealthFacilitiesByGeoLocationService,
    getHealthFacilityByIdService,
    updateHealthFacilityService
} from '../services/healthFacility.service';

// Create Health Facility Controller
// Code: ESAVI-HFAC-001
const createHealthFacility = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createHealthFacilityService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('healthFacility.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-HFAC-001: Error creating Health Facility: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.createdFailed', req.lang), 500, 'HFAC_001_CREATION_FAILED', error));
    }
}

// Get Active Health Facilities By GeoLocation Controller
// Code: ESAVI-HFAC-002A
const getHealthFacilitiesByLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getHealthFacilitiesByGeoLocationService(id, req.lang, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('healthFacility.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-HFAC-002A: Error getting health facilities by geoLocationId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.getFailedPlural', req.lang), 500, 'HFAC_002A_GET_BY_GEOLOCATION_FAILED', error));
    }
}

// Get All Health Facilities By GeoLocation Controller - For Admin
// Code: ESAVI-HFAC-002B
const getAllHealthFacilitiesByLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllHealthFacilitiesByGeoLocationService(id, req.lang, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('healthFacility.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-HFAC-002B: Error getting all health facilities by geoLocationId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.getFailedPlural', req.lang), 500, 'HFAC_002B_GET_BY_GEOLOCATION_FAILED', error));
    }
}

// Get Health Facility By ID Controller
// Code: ESAVI-HFAC-003
const getHealthFacilityById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getHealthFacilityByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('healthFacility.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-HFAC-003: Error fetching Health Facility by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.getFailed', req.lang), 500, 'HFAC_003_FETCH_FAILED', error));
    }
}

// Update Health Facility Controller
// Code: ESAVI-HFAC-004
const updateHealthFacility = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateHealthFacilityService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('healthFacility.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-HFAC-004: Error updating Health Facility: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.updatedFailed', req.lang), 500, 'HFAC_004_UPDATE_FAILED', error));
    }
}

export {
    createHealthFacility,
    getHealthFacilitiesByLocation,
    getAllHealthFacilitiesByLocation,
    getHealthFacilityById,
    updateHealthFacility
}
