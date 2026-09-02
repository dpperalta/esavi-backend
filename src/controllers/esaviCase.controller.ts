import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, EsaviCaseListFilters } from '../types';
import {
    createEsaviCaseService,
    getAllEsaviCasesService,
    getEsaviCaseByIdService,
    getEsaviCasesService,
    setEsaviCaseActivationService,
    updateEsaviCaseService
} from '../services/esaviCase.service';

// The query filters of 002A and 002B. Only what actually arrives travels to the service,
// so an absent filter never turns into an `undefined` in the where clause. Nothing is
// validated here: the shape of the query was already checked by esaviCaseListValidator
const listFilters = (req: Request): EsaviCaseListFilters => ({
    code: req.query.code as string | undefined,
    patientId: req.query.patientId as string | undefined,
    healthFacilityId: req.query.healthFacilityId as string | undefined,
    geoLocationId: req.query.geoLocationId as string | undefined,
    reportDate: req.query.reportDate as string | undefined,
    reportDateFrom: req.query.reportDateFrom as string | undefined,
    reportDateTo: req.query.reportDateTo as string | undefined,
    eventDate: req.query.eventDate as string | undefined,
    eventDateFrom: req.query.eventDateFrom as string | undefined,
    eventDateTo: req.query.eventDateTo as string | undefined,
    reportFillingDate: req.query.reportFillingDate as string | undefined,
    reportFillingDateFrom: req.query.reportFillingDateFrom as string | undefined,
    reportFillingDateTo: req.query.reportFillingDateTo as string | undefined
});

// Create ESAVI Case Controller
// Code: ESAVI-CASE-001
const createEsaviCase = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createEsaviCaseService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('esaviCase.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-001: Error creating ESAVI Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.createdFailed', req.lang), 500, 'CASE_001_CREATION_FAILED', error));
    }
}

// Get ESAVI Cases Controller
// Code: ESAVI-CASE-002A
const getEsaviCases = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getEsaviCasesService(listFilters(req), limit, offset, req.user as AuthUser);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-002A: Error fetching ESAVI Cases: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.getFailedPlural', req.lang), 500, 'CASE_002A_FETCH_FAILED', error));
    }
}

// Get All ESAVI Cases Controller - For Admin
// Code: ESAVI-CASE-002B
const getAllEsaviCases = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllEsaviCasesService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-002B: Error fetching all ESAVI Cases: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.getFailedPlural', req.lang), 500, 'CASE_002B_FETCH_FAILED', error));
    }
}

// Get ESAVI Case By ID Controller
// Code: ESAVI-CASE-003
const getEsaviCaseById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getEsaviCaseByIdService(id, req.lang, canViewInactive(req.user as AuthUser), req.user as AuthUser);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-003: Error fetching ESAVI Case by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.getFailed', req.lang), 500, 'CASE_003_FETCH_FAILED', error));
    }
}

// Update ESAVI Case Controller
// Code: ESAVI-CASE-004
const updateEsaviCase = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateEsaviCaseService(id, req.body, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-004: Error updating ESAVI Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.updatedFailed', req.lang), 500, 'CASE_004_UPDATE_FAILED', error));
    }
}

// Delete ESAVI Case Controller - Soft delete
// Code: ESAVI-CASE-005A
const deleteEsaviCase = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setEsaviCaseActivationService(id, req.user, req.lang, false);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-005A: Error deleting ESAVI Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.deletedFailed', req.lang), 500, 'CASE_005A_DELETE_FAILED', error));
    }
}

// Activate ESAVI Case Controller - For SuperAdmin
// Code: ESAVI-CASE-005B
const activateEsaviCase = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setEsaviCaseActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('esaviCase.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-CASE-005B: Error activating ESAVI Case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('esaviCase.activatedFailed', req.lang), 500, 'CASE_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createEsaviCase,
    getEsaviCases,
    getAllEsaviCases,
    getEsaviCaseById,
    updateEsaviCase,
    deleteEsaviCase,
    activateEsaviCase
}
