import { NextFunction, Request, Response } from 'express';
import { createGeoLevelTypeService, getActiveGeoLevelTypesService, getAllGeoLevelTypesService, getGeoLevelTypeByIdService, setGeoLevelTypeActivationService, updateGeoLevelTypeService } from '../services/geoLevelType.service'
import { esaviLog, getMessage, canViewInactive, AppError } from '../helpers';
import { CreateGeoLevelTypeInput } from '../types/geography/geoLevelType.types';

// Create Geographic Level Type Controller
// Code: ESAVI-GEOTYPE-001
const createGeoLevelType = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createGeoLevelTypeService({ ...req.body } as CreateGeoLevelTypeInput, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('geoLevelType.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-001: Error creating GeoLevelType: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.createdFailed', req.lang), 500, 'GEOTYPE_001_CREATION_FAILED', error));
    }
}

// Get Geographic Level Types Controller
// Code: ESAVI-GEOTYPE-002
const getGeoLevelTypes = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = canViewInactive(req.user) ? await getAllGeoLevelTypesService( limit,  offset ) : await getActiveGeoLevelTypesService( limit,  offset );
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLevelType.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-002: Error fetching GeoLevelTypes: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.getFailedPlural', req.lang), 500, 'GEOTYPE_002_FETCH_FAILED', error));
    }
}

// Get Geographic Level Type by ID Controller
// Code: ESAVI-GEOTYPE-003
const getGeoLevelTypeById = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        const data = await getGeoLevelTypeByIdService(id, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLevelType.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-003: Error fetching GeoLevelType by Id: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.getFailed', req.lang), 500, 'GEOTYPE_003_FETCH_FAILED', error));
    }
}

// Update Geographic Level Type Controller
// Code: ESAVI-GEOTYPE-004
const updateGeoLevelType = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        const data = await updateGeoLevelTypeService(id, { ...req.body } as Partial<CreateGeoLevelTypeInput>, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLevelType.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-004: Error updating GeoLevelType: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.updatedFailed', req.lang), 500, 'GEOTYPE_004_UPDATE_FAILED', error));
    }
}

// Soft delete Geographic Level Type Controller
// Code: ESAVI-GEOTYPE-005A
const deleteGeoLevelType = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        await setGeoLevelTypeActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLevelType.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-005A: Error deleting GeoLevelType: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.deletedFailed', req.lang), 500, 'GEOTYPE_005A_DELETE_FAILED', error));
    }
}

// Activate Geographic Level Type Controller
// Code: ESAVI-GEOTYPE-005B
const activateGeoLevelType = async(req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const id = (req.params.id).toString().trim();
        await setGeoLevelTypeActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('geoLevelType.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-GEOTYPE-005B: Error activating GeoLevelType: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('geoLevelType.activatedFailed', req.lang), 500, 'GEOTYPE_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createGeoLevelType,
    getGeoLevelTypes,
    getGeoLevelTypeById,
    updateGeoLevelType,
    deleteGeoLevelType,
    activateGeoLevelType
}