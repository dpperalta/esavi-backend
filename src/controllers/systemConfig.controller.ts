import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { SystemConfigListFilters, SystemConfigValueType } from '../types';
import {
    createSystemConfigService,
    getActiveSystemConfigsService,
    getAllSystemConfigsService,
    getSystemConfigByIdService,
    getSystemConfigByCodeService
} from '../services/systemConfig.service';

// Unwraps the three query filters, identical in both listings. The validator has already restricted
// valueType to the five literals of the CHECK, so the cast here is over an already checked value
const readListFilters = (query: Request['query']): SystemConfigListFilters => ({
    scope: query.scope ? (query.scope as string).trim() : undefined,
    valueType: query.valueType ? (query.valueType as SystemConfigValueType) : undefined,
    search: query.search ? (query.search as string).trim() : undefined
});

// Create System Config Controller
// Code: ESAVI-SYSCONF-001
const createSystemConfig = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createSystemConfigService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('systemConfig.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-001: Error creating System Config: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.createdFailed', req.lang), 500, 'SYSCONF_001_CREATION_FAILED', error));
    }
}

// Get Active System Configs Controller
// Code: ESAVI-SYSCONF-002A
const getSystemConfigs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveSystemConfigsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('systemConfig.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-002A: Error getting System Configs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.getFailedPlural', req.lang), 500, 'SYSCONF_002A_FETCH_FAILED', error));
    }
}

// Get All System Configs Controller - For Admin
// Code: ESAVI-SYSCONF-002B
const getAllSystemConfigs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllSystemConfigsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('systemConfig.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-002B: Error getting all System Configs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.getFailedPlural', req.lang), 500, 'SYSCONF_002B_FETCH_FAILED', error));
    }
}

// Get System Config by ID Controller
// Code: ESAVI-SYSCONF-003
const getSystemConfigById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        // The same predicate travels in the last two arguments, and that is not a copy-paste: seeing
        // an inactive row and reading a decrypted secret are two different decisions that happen to
        // rest on the same role. canViewInactive is SUPERADMIN-only, and SUPERADMIN is exactly who
        // may decrypt, so the two collapse into one predicate here and stay two parameters in the
        // service — the day one of them moves, only this line changes
        const canSeeEverything = canViewInactive(req.user);
        const data = await getSystemConfigByIdService(id, req.lang, canSeeEverything, canSeeEverything);
        return res.status(200).json({
            ok: true,
            message: getMessage('systemConfig.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-003: Error getting System Config by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.getFailed', req.lang), 500, 'SYSCONF_003_FETCH_FAILED', error));
    }
}

// Get System Config by code and scope Controller
// Code: ESAVI-SYSCONF-006
const getSystemConfigByCode = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const code = (req.params.code).toString().trim();
    const scope = req.query.scope ? (req.query.scope as string).trim() : undefined;
    try {
        // The same two decisions as the 003, resting on the same predicate: this endpoint is the
        // other door to the same row
        const canSeeEverything = canViewInactive(req.user);
        const data = await getSystemConfigByCodeService(code, scope, req.lang, canSeeEverything, canSeeEverything);
        return res.status(200).json({
            ok: true,
            message: getMessage('systemConfig.getByCodeSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-006: Error getting System Config by code: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.getByCodeFailed', req.lang), 500, 'SYSCONF_006_FETCH_FAILED', error));
    }
}

export {
    createSystemConfig,
    getSystemConfigs,
    getAllSystemConfigs,
    getSystemConfigById,
    getSystemConfigByCode
}
