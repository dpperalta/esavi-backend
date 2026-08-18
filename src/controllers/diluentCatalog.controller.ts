import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { DiluentCatalogListFilters } from '../types';
import {
    createDiluentCatalogService,
    getActiveDiluentCatalogsService,
    getAllDiluentCatalogsService,
    getDiluentCatalogByIdService,
    updateDiluentCatalogService,
    setDiluentCatalogActivationService
} from '../services/diluentCatalog.service';

// Unwraps the single query filter, identical in both listings
const readListFilters = (query: Request['query']): DiluentCatalogListFilters => ({
    search: query.search ? (query.search as string).trim() : undefined
});

// Create Diluent Catalog Controller
// Code: ESAVI-DILUENT-001
const createDiluentCatalog = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createDiluentCatalogService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('diluentCatalog.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-001: Error creating Diluent Catalog: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.createdFailed', req.lang), 500, 'DILUENT_001_CREATION_FAILED', error));
    }
}

// Get Active Diluent Catalogs Controller
// Code: ESAVI-DILUENT-002A
const getDiluentCatalogs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveDiluentCatalogsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-002A: Error getting Diluent Catalogs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.getFailedPlural', req.lang), 500, 'DILUENT_002A_FETCH_FAILED', error));
    }
}

// Get All Diluent Catalogs Controller - For Admin
// Code: ESAVI-DILUENT-002B
const getAllDiluentCatalogs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        // The same single filter as the public listing: this variant adds none of its own
        const data = await getAllDiluentCatalogsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-002B: Error getting all Diluent Catalogs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.getFailedPlural', req.lang), 500, 'DILUENT_002B_FETCH_FAILED', error));
    }
}

// Get Diluent Catalog by ID Controller
// Code: ESAVI-DILUENT-003
const getDiluentCatalogById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        // canViewInactive is SUPERADMIN-only, so an ADMIN gets the same 404 as a USER even though the
        // 002B listing does show it inactive rows. The asymmetry is deliberate and is the same one
        // healthFacility, diagnosticTerm and vaccineWhodrug already have
        const data = await getDiluentCatalogByIdService(id, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-003: Error getting Diluent Catalog by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.getFailed', req.lang), 500, 'DILUENT_003_FETCH_FAILED', error));
    }
}

// Update Diluent Catalog Controller
// Code: ESAVI-DILUENT-004
const updateDiluentCatalog = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateDiluentCatalogService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-004: Error updating Diluent Catalog: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.updatedFailed', req.lang), 500, 'DILUENT_004_UPDATE_FAILED', error));
    }
}

// Delete Diluent Catalog Controller - Soft delete
// Code: ESAVI-DILUENT-005A
const deleteDiluentCatalog = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setDiluentCatalogActivationService(id, req.user, req.lang, false);
        // No data: there is nothing left to return but the fact itself
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-005A: Error deleting Diluent Catalog: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.deletedFailed', req.lang), 500, 'DILUENT_005A_DELETE_FAILED', error));
    }
}

// Activate Diluent Catalog Controller - For SuperAdmin
// Code: ESAVI-DILUENT-005B
const activateDiluentCatalog = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setDiluentCatalogActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('diluentCatalog.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-005B: Error activating Diluent Catalog: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.activatedFailed', req.lang), 500, 'DILUENT_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createDiluentCatalog,
    getDiluentCatalogs,
    getAllDiluentCatalogs,
    getDiluentCatalogById,
    updateDiluentCatalog,
    deleteDiluentCatalog,
    activateDiluentCatalog
};
