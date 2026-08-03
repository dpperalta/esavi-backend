import { Request, Response, NextFunction } from "express"
import { AppError, canViewInactive, esaviLog, getMessage } from "../helpers";
import { AuthUser } from "../types";
import { createCatalogItemService, getActiveCatalogItemsByTypeService, getAllCatalogItemsByTypeService, getCatalogItemByIdService, setCatalogItemActivationService, updateCatalogItemService } from "../services/catalogItem.service";

// Create Catalog Item Controller
// Code: ESAVI-CATITEM-001
const createCatalogItem = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try{
        const data = await createCatalogItemService(req.body, { userId: req.user?.userId } as AuthUser, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('catalogItem.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-001: Error creating Catalog Item: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.createdFailed', req.lang), 500, 'CATITEM_001_CREATION_FAILED', error));
    }
}

// Get Catalog Items by Type Controller
// Code: ESAVI-CATITEM-002A
const getCatalogItemsByType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {        
        const data = await getActiveCatalogItemsByTypeService(id.toString().trim(), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-002A: Error fetching Catalog Items by Catalog Type: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.getFailedPlural', req.lang), 500, 'CATITEM_002A_FETCH_FAILED', error));
    }
}

// Get Catalog Items for administration
// Code: ESAVI-CATITEM-002B
const getAllCatalogItemsByType = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllCatalogItemsByTypeService(id.toString().trim() || '', limit, offset, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-002B: Error fetching Catalog Items by Catalog Type for administration: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.getFailedPlural', req.lang), 500, 'CATITEM_002B_FETCH_FAILED', error));
    }
}

// Get catalog items by ID
// Code: ESAVI-CATITEM-003
const getCatalogItemById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getCatalogItemByIdService(id.toString().trim(), req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-003: Error fetching Catalog Item by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.getFailed', req.lang), 500, 'CATITEM_003_FETCH_FAILED', error));
    }
}

// Update Catalog Item
// Code: ESAVI-CATITEM-004
const updateCatalogItem = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await updateCatalogItemService(id.toString().trim(), req.body, { userId: req.user?.userId } as AuthUser, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-004: Error updating Catalog Item: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.updatedFailed', req.lang), 500, 'CATITEM_004_UPDATE_FAILED', error));
    }
}

// Soft delete or Activate Catalog Item Controller - For Admin
// Code: ESAVI-CATITEM-005A (Delete)
const deleteCatalogItem = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try{
        await setCatalogItemActivationService( id, { userId: req.user?.userId } as AuthUser, req.lang, false );
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-005A: Error deleting Catalog Item: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.deletedFailed', req.lang), 500, 'CATITEM_005A_DELETE_FAILED', error));
    }
}

// Activate Catalog Item Controller - For Admin
// Code: ESAVI-CATITEM-005B (Activate)
const activateCatalogItem = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try{
        await setCatalogItemActivationService( id, { userId: req.user?.userId } as AuthUser, req.lang, true );
        return res.status(200).json({
            ok: true,
            message: getMessage('catalogItem.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CATITEM-005B: Error activating Catalog Item: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('catalogItem.activatedFailed', req.lang), 500, 'CATITEM_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createCatalogItem,
    getCatalogItemsByType,
    getAllCatalogItemsByType,
    getCatalogItemById,
    updateCatalogItem,
    deleteCatalogItem,
    activateCatalogItem
}