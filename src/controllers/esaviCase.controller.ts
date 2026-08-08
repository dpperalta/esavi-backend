import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { EsaviCaseListFilters } from '../types';
import {
    createEsaviCaseService,
    getAllEsaviCasesService,
    getEsaviCasesService
} from '../services/esaviCase.service';

// The three query filters of 002A and 002B. Only what actually arrives travels to the service,
// so an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): EsaviCaseListFilters => ({
    patientId: req.query.patientId as string | undefined,
    healthFacilityId: req.query.healthFacilityId as string | undefined,
    reportDateFrom: req.query.reportDateFrom as string | undefined,
    reportDateTo: req.query.reportDateTo as string | undefined
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
        const data = await getEsaviCasesService(listFilters(req), limit, offset);
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

export {
    createEsaviCase,
    getEsaviCases,
    getAllEsaviCases
}
