import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createInvestigationVaccineAdministeredService,
    getAllInvestigationVaccinesAdministeredByInvestigationService,
    getInvestigationVaccineAdministeredByIdService,
    getInvestigationVaccinesAdministeredByCaseIdService,
    getInvestigationVaccinesAdministeredByInvestigationService,
    setInvestigationVaccineAdministeredActivationService,
    updateInvestigationVaccineAdministeredService
} from '../services/investigationVaccineAdministered.service';

// Create Investigation Vaccine Administered Controller
// Code: ESAVI-INVVACAD-001
const createInvestigationVaccineAdministered = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationVaccineAdministeredService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-001: Error creating Investigation Vaccine Administered: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.createdFailed', req.lang), 500, 'INVVACAD_001_CREATION_FAILED', error));
    }
}

// Get Active Investigation Vaccines Administered By Investigation Controller
// Code: ESAVI-INVVACAD-002A
const getInvestigationVaccinesAdministeredByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationVaccinesAdministeredByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-002A: Error fetching Investigation Vaccines Administered by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.getFailedPlural', req.lang), 500, 'INVVACAD_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Vaccines Administered By Investigation Controller
// Code: ESAVI-INVVACAD-002B
const getAllInvestigationVaccinesAdministeredByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationVaccinesAdministeredByInvestigationService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-002B: Error fetching all Investigation Vaccines Administered by Investigation: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.getFailedPlural', req.lang), 500, 'INVVACAD_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Vaccine Administered By ID Controller
// Code: ESAVI-INVVACAD-003
const getInvestigationVaccineAdministeredById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getInvestigationVaccineAdministeredByIdService(
            id,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-003: Error fetching Investigation Vaccine Administered by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.getFailed', req.lang), 500, 'INVVACAD_003_FETCH_FAILED', error));
    }
}

// Get Investigation Vaccines Administered By Case ID Controller
// Code: ESAVI-INVVACAD-006
const getInvestigationVaccinesAdministeredByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const caseId = (req.params.caseId).toString().trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationVaccinesAdministeredByCaseIdService(
            caseId,
            req.lang,
            canViewInactive(req.user as AuthUser),
            limit,
            offset
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-006: Error fetching Investigation Vaccines Administered by Case ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.getFailedPlural', req.lang), 500, 'INVVACAD_006_FETCH_FAILED', error));
    }
}

// Update Investigation Vaccine Administered Controller
// Code: ESAVI-INVVACAD-004
const updateInvestigationVaccineAdministered = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateInvestigationVaccineAdministeredService(
            id,
            req.body,
            req.user,
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-004: Error updating Investigation Vaccine Administered: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.updatedFailed', req.lang), 500, 'INVVACAD_004_UPDATE_FAILED', error));
    }
}

// Delete Investigation Vaccine Administered Controller
// Code: ESAVI-INVVACAD-005A
const deleteInvestigationVaccineAdministered = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setInvestigationVaccineAdministeredActivationService(id, req.user, req.lang, false);
        // No data: a state operation reports that it happened, not the row it happened to. It is the
        // rule tests/contract/response.test.ts polices over the source of every controller
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.deletedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-005A: Error deleting Investigation Vaccine Administered: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.deletedFailed', req.lang), 500, 'INVVACAD_005A_DELETE_FAILED', error));
    }
}

// Activate Investigation Vaccine Administered Controller
// Code: ESAVI-INVVACAD-005B
const activateInvestigationVaccineAdministered = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        await setInvestigationVaccineAdministeredActivationService(id, req.user, req.lang, true);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.activatedSuccess', req.lang)
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-005B: Error activating Investigation Vaccine Administered: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.activatedFailed', req.lang), 500, 'INVVACAD_005B_ACTIVATION_FAILED', error));
    }
}

export {
    createInvestigationVaccineAdministered,
    getInvestigationVaccinesAdministeredByInvestigation,
    getAllInvestigationVaccinesAdministeredByInvestigation,
    getInvestigationVaccineAdministeredById,
    getInvestigationVaccinesAdministeredByCaseId,
    updateInvestigationVaccineAdministered,
    deleteInvestigationVaccineAdministered,
    activateInvestigationVaccineAdministered
}
