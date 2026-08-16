import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { VaccineWhodrugListFilters } from '../types';
import {
    createVaccineWhodrugService,
    getActiveVaccineWhodrugsService
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

export {
    createVaccineWhodrug,
    getVaccineWhodrugs
};
