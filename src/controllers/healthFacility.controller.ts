import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from "../helpers";
import { AuthUser } from "../types";
import { createHealthFacilityService, getHealthFacilitiesByGeoLocationService } from '../services/healthFacility.service';

// Create Health Facility Controller
// Code: ESAVI-HF-001
const createHealthFacility = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createHealthFacilityService(req.body, { userId: req.user?.userId } as AuthUser, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('healthFacility.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAIV-HF-001: Error creating Health Facility: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.createdFailed', req.lang), 500, 'HF_001_CREATION_FAILED', error));
    }
}

// Get health facilities of a given geoLocationId with pagination and option to include inactive (for admin users)
// Code: ESAVI-HF-002
const getHealthFacilitiesByLocation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = parseInt(req.query.offset as string) || 0;
    try {
        const data = await getHealthFacilitiesByGeoLocationService(id, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('healthFacility.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAIV-HF-002: Error getting health facilities by geoLocationId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('healthFacility.getFailedPlural', req.lang), 500, 'HF_002_GET_BY_GEOLOCATION_FAILED', error));
    }
}


export {
    createHealthFacility,
    getHealthFacilitiesByLocation
}
