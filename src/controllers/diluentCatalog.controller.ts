import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { DiluentCatalogListFilters } from '../types';
import {
    createDiluentCatalogService,
    getActiveDiluentCatalogsService,
    getAllDiluentCatalogsService
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

export {
    createDiluentCatalog,
    getDiluentCatalogs,
    getAllDiluentCatalogs
};
