import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createInvestigationVaccineAdministeredService,
    getAllInvestigationVaccinesAdministeredByInvestigationService,
    getInvestigationVaccinesAdministeredByInvestigationService
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

export {
    createInvestigationVaccineAdministered,
    getInvestigationVaccinesAdministeredByInvestigation,
    getAllInvestigationVaccinesAdministeredByInvestigation
}
