import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { VaccineWhodrugListFilters } from '../types';
import {
    createVaccineWhodrugService,
    getActiveVaccineWhodrugsService,
    getAllVaccineWhodrugsService,
    getVaccineWhodrugByIdService,
    updateVaccineWhodrugService,
    setVaccineWhodrugActivationService
} from '../services/vaccineWhodrug.service';

// Unwraps the five query filters, identical in both listings. The two booleans arrive as the
// strings a query string carries, so they are compared against undefined first and read as
// 'true' afterwards: a plain cast would turn ?isPreferred=false into a truthy value
const readListFilters = (query: Request['query']): VaccineWhodrugListFilters => ({
    search: query.search ? (query.search as string).trim() : undefined,
    language: query.language ? (query.language as string).trim() : undefined,
    iso3Code: query.iso3Code ? (query.iso3Code as string).trim() : undefined,
    isPreferred: query.isPreferred !== undefined ? query.isPreferred === 'true' : undefined,
    isGeneric: query.isGeneric !== undefined ? query.isGeneric === 'true' : undefined
});

// Create Vaccine Whodrug Controller
// Code: ESAVI-WHODRUG-001
const createVaccineWhodrug = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createVaccineWhodrugService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('vaccineWhodrug.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-001: Error creating Vaccine WHODrug: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.createdFailed', req.lang), 500, 'WHODRUG_001_CREATION_FAILED', error));
    }
}

// Get Active Vaccine Whodrugs Controller
// Code: ESAVI-WHODRUG-002A
const getVaccineWhodrugs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getActiveVaccineWhodrugsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-002A: Error getting Vaccine WHODrugs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.getFailedPlural', req.lang), 500, 'WHODRUG_002A_FETCH_FAILED', error));
    }
}

// Get All Vaccine Whodrugs Controller - For Admin
// Code: ESAVI-WHODRUG-002B
const getAllVaccineWhodrugs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        // The same five filters as the public listing: this variant adds none of its own
        const data = await getAllVaccineWhodrugsService(readListFilters(req.query), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-002B: Error getting all Vaccine WHODrugs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.getFailedPlural', req.lang), 500, 'WHODRUG_002B_FETCH_FAILED', error));
    }
}

// Get Vaccine Whodrug by ID Controller
// Code: ESAVI-WHODRUG-003
const getVaccineWhodrugById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        // canViewInactive is SUPERADMIN-only, so an ADMIN gets the same 404 as a USER even though
        // the 002B listing does show it inactive rows. The asymmetry is deliberate and is the same
        // one healthFacility and diagnosticTerm already have
        const data = await getVaccineWhodrugByIdService(id, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-003: Error getting Vaccine WHODrug by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.getFailed', req.lang), 500, 'WHODRUG_003_FETCH_FAILED', error));
    }
}

// Update Vaccine Whodrug Controller
// Code: ESAVI-WHODRUG-004
const updateVaccineWhodrug = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateVaccineWhodrugService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-004: Error updating Vaccine WHODrug: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.updatedFailed', req.lang), 500, 'WHODRUG_004_UPDATE_FAILED', error));
    }
}

// Delete Vaccine Whodrug Controller - Soft delete
// Code: ESAVI-WHODRUG-005A
const deleteVaccineWhodrug = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setVaccineWhodrugActivationService(id, req.user, req.lang, false);
        // No data: there is nothing left to return but the fact itself
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-005A: Error deleting Vaccine WHODrug: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.deletedFailed', req.lang), 500, 'WHODRUG_005A_DELETE_FAILED', error));
    }
}

// Activate Vaccine Whodrug Controller - For SuperAdmin
// Code: ESAVI-WHODRUG-005B
const activateVaccineWhodrug = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setVaccineWhodrugActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-005B: Error activating Vaccine WHODrug: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.activatedFailed', req.lang), 500, 'WHODRUG_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createVaccineWhodrug,
    getVaccineWhodrugs,
    getAllVaccineWhodrugs,
    getVaccineWhodrugById,
    updateVaccineWhodrug,
    deleteVaccineWhodrug,
    activateVaccineWhodrug
};
