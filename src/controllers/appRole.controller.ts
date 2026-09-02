import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AppRoleListFilters, AuthUser } from '../types';
import {
    createAppRoleService,
    getActiveAppRolesService,
    getAllAppRolesService,
    getAppRoleByIdService,
    updateAppRoleService,
    setAppRoleActivationService
} from '../services/appRole.service';

// Unwraps the two query filters, identical in both listings
const readListFilters = (query: Request['query']): AppRoleListFilters => ({
    name: query.name ? (query.name as string).trim() : undefined,
    code: query.code ? (query.code as string).trim() : undefined
});

// Create App Role Controller
// Code: ESAVI-APPROLE-001
const createAppRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createAppRoleService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('appRole.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-001: Error creating App Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.createdFailed', req.lang), 500, 'APPROLE_001_CREATION_FAILED', error));
    }
}

// Get App Roles Controller
// Code: ESAVI-APPROLE-002A
const getAppRoles = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveAppRolesService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-002A: Error fetching App Roles: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.getFailedPlural', req.lang), 500, 'APPROLE_002A_FETCH_FAILED', error));
    }
}

// Get All App Roles Controller - For Admin
// Code: ESAVI-APPROLE-002B
const getAllAppRoles = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllAppRolesService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-002B: Error fetching all App Roles: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.getFailedPlural', req.lang), 500, 'APPROLE_002B_FETCH_FAILED', error));
    }
}

// Get App Role By ID Controller
// Code: ESAVI-APPROLE-003
const getAppRoleById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getAppRoleByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-003: Error fetching App Role by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.getFailed', req.lang), 500, 'APPROLE_003_FETCH_FAILED', error));
    }
}

// Update App Role Controller
// Code: ESAVI-APPROLE-004
const updateAppRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateAppRoleService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-004: Error updating App Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.updatedFailed', req.lang), 500, 'APPROLE_004_UPDATE_FAILED', error));
    }
}

// Delete App Role Controller - Soft delete
// Code: ESAVI-APPROLE-005A
const deleteAppRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppRoleActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-005A: Error deleting App Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.deletedFailed', req.lang), 500, 'APPROLE_005A_DELETE_FAILED', error));
    }
}

// Activate App Role Controller - For SuperAdmin
// Code: ESAVI-APPROLE-005B
const activateAppRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppRoleActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('appRole.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-005B: Error activating App Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.activatedFailed', req.lang), 500, 'APPROLE_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createAppRole,
    getAppRoles,
    getAllAppRoles,
    getAppRoleById,
    updateAppRole,
    deleteAppRole,
    activateAppRole
}
