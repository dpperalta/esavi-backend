import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    assignAppUserRoleService,
    getAppUserRolesByUserService,
    getAllAppUserRolesByUserService,
    getAppUserRoleByIdService,
    getAppUserRolesByRoleService,
    setAppUserRoleActivationService
} from '../services/appUserRole.service';

// Assign App User Role Controller
// Code: ESAVI-USERROLE-001
const assignAppUserRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        // A new pair is a 201; an existing but revoked pair is reactivated and answers 200.
        // The client never knows the userRoleId of a revoked row, so it cannot be asked to
        // reach for PATCH /activate/:id instead
        const { assignment, created } = await assignAppUserRoleService(req.body, req.user, req.lang);
        return res.status(created ? 201 : 200).json({
            ok: true,
            message: getMessage(created ? 'appUserRole.assignSuccess' : 'appUserRole.reactivateSuccess', req.lang),
            data: assignment
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-001: Error assigning App User Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.assignFailed', req.lang), 500, 'USERROLE_001_ASSIGN_FAILED', error));
    }
}

// Get App User Roles By User Controller
// Code: ESAVI-USERROLE-002A
const getAppUserRolesByUser = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const userId = (req.params.userId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAppUserRolesByUserService(userId, req.lang, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-002A: Error getting App User Roles by userId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.fetchFailed', req.lang), 500, 'USERROLE_002A_FETCH_FAILED', error));
    }
}

// Get All App User Roles By User Controller - For Admin
// Code: ESAVI-USERROLE-002B
const getAllAppUserRolesByUser = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const userId = (req.params.userId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllAppUserRolesByUserService(userId, req.lang, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-002B: Error getting all App User Roles by userId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.fetchFailed', req.lang), 500, 'USERROLE_002B_FETCH_FAILED', error));
    }
}

// Get App User Role By ID Controller
// Code: ESAVI-USERROLE-003
const getAppUserRoleById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getAppUserRoleByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-003: Error getting App User Role by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.fetchFailed', req.lang), 500, 'USERROLE_003_FETCH_FAILED', error));
    }
}

// Get App User Roles By Role Controller - For Admin
// Code: ESAVI-USERROLE-006
const getAppUserRolesByRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const roleId = (req.params.roleId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAppUserRolesByRoleService(roleId, req.lang, limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-006: Error getting App User Roles by roleId: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.fetchFailed', req.lang), 500, 'USERROLE_006_FETCH_FAILED', error));
    }
}

// Revoke App User Role Controller
// Code: ESAVI-USERROLE-005A
const revokeAppUserRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppUserRoleActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.revokeSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-005A: Error revoking App User Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.assignFailed', req.lang), 500, 'USERROLE_005A_DELETE_FAILED', error));
    }
}

// Reinstate App User Role Controller - For SuperAdmin
// Code: ESAVI-USERROLE-005B
const reinstateAppUserRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setAppUserRoleActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('appUserRole.reinstateSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-005B: Error reinstating App User Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.assignFailed', req.lang), 500, 'USERROLE_005B_ACTIVATION_FAILED', error));
    }
}

export {
    assignAppUserRole,
    getAppUserRolesByUser,
    getAllAppUserRolesByUser,
    getAppUserRoleById,
    getAppUserRolesByRole,
    revokeAppUserRole,
    reinstateAppUserRole
};
