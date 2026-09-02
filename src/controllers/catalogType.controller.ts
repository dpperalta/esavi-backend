import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage, canViewInactive } from '../helpers';
import { CatalogTypeListFilters } from '../types';
import { createCatalogTypeService, getActiveCatalogTypesService, getAllCatalogTypesService, getCatalogTypeByIdService, setCatalogTypeActivationService, updateCatalogTypeService } from '../services/catalogType.service';

// Unwraps the two query filters, identical in both listings
const readListFilters = (query: Request['query']): CatalogTypeListFilters => ({
    name: query.name ? (query.name as string).trim() : undefined,
    code: query.code ? (query.code as string).trim() : undefined
});

// Create Catalog Type Controller
// Code: ESAVI-CATTYPE-001
const createCatalogType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createCatalogTypeService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('catalogType.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-001: Error creating Catalog Type: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.createdFailed', req.lang), 500, 'CATTYPE_001_CREATION_FAILED', error));
    }
}

// Get Catalog Types Controller
// Code: ESAVI-CATTYPE-002
const getCatalogTypes = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const filters = readListFilters(req.query);
        const data = canViewInactive(req.user) ? await getAllCatalogTypesService(filters, limit, offset) : await getActiveCatalogTypesService(filters, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogType.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-002: Error fetching Catalog Types: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.getFailedPlural', req.lang), 500, 'CATTYPE_002_FETCH_FAILED', error));
    }
}

// Get Catalog Type by ID Controller
// Code: ESAVI-CATTYPE-003
const getCatalogTypeById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getCatalogTypeByIdService(id.toString(), req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogType.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-003: Error fetching Catalog Type by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.getFailed', req.lang), 500, 'CATTYPE_003_FETCH_FAILED', error));
    }
}

// Update Catalog Type Controller - For SuperAdmin
// Code: ESAVI-CATTYPE-004
const updateCatalogType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateCatalogTypeService(id.toString(), req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogType.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-004: Error updating Catalog Type: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.updatedFailed', req.lang), 500, 'CATTYPE_004_UPDATE_FAILED', error));
    }
}

// Soft delete Catalog Type Controller - For Admin
// Code: ESAVI-CATTYPE-005A (Delete)
const deleteCatalogType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setCatalogTypeActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogType.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-005A: Error deleting Catalog Type: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.deletedFailed', req.lang), 500, 'CATTYPE_005A_DELETE_FAILED', error));
    }
}

// Activate Catalog Type Controller - For SuperAdmin
// Code: ESAVI-CATTYPE-005B (Activate)
const activateCatalogType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setCatalogTypeActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogType.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CATTYPE-005B: Error activating Catalog Type: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogType.activatedFailed', req.lang), 500, 'CATTYPE_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createCatalogType,
    getCatalogTypes,
    getCatalogTypeById,
    updateCatalogType,
    deleteCatalogType,
    activateCatalogType
}