import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { ImportVaccineWhodrugsInput, VaccineWhodrugListFilters, VaccineWhodrugTreeFilters } from '../types';
import {
    createVaccineWhodrugService,
    getActiveVaccineWhodrugsService,
    getAllVaccineWhodrugsService,
    getVaccineWhodrugByIdService,
    updateVaccineWhodrugService,
    setVaccineWhodrugActivationService,
    importVaccineWhodrugsService,
    getWhodrugAbbreviationsService,
    getWhodrugDrugNamesService,
    getWhodrugMaHoldersService,
    getWhodrugFormsService,
    getWhodrugStrengthsService
} from '../services/vaccineWhodrug.service';

// Unwraps the five query filters, identical in both listings. The two booleans arrive as the
// strings a query string carries, so they are compared against undefined first and read as
// 'true' afterwards: a plain cast would turn ?isPreferred=false into a truthy value
const readListFilters = (query: Request['query']): VaccineWhodrugListFilters => ({
    search: query.search ? (query.search as string).trim() : undefined,
    name: query.name ? (query.name as string).trim() : undefined,
    code: query.code ? (query.code as string).trim() : undefined,
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

// Import Vaccine Whodrugs Controller - For SuperAdmin
// Code: ESAVI-WHODRUG-007
const importVaccineWhodrugs = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    // A request with no multipart body at all leaves req.body undefined — multer only fills it when
    // it has something to parse — and that is precisely the request that must end in a 400 for the
    // missing file, not in a 500 for reading a key off undefined
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Both fields arrive as text fields of the multipart body, so the boolean comes as a string and
    // is turned into a value here. The file itself was left in req.file by uploadSingleFile. There
    // is no encoding: a .xlsx resolves it inside the format
    const data: ImportVaccineWhodrugsInput = {
        dictionaryVersion: body.dictionaryVersion ? (body.dictionaryVersion as string).trim() : undefined,
        dryRun: body.dryRun !== undefined ? String(body.dryRun) === 'true' : undefined
    };
    try {
        // Checked here and again in the service: the controller is what turns a request with no file
        // into a 400 instead of letting it reach the parser as a crash
        if (!req.file) {
            throw new AppError(getMessage('vaccineWhodrug.fileRequired', req.lang), 400, 'WHODRUG_007_FILE_REQUIRED');
        }
        // 200 and not 201: there is no identifiable resource to return and no URL to point at.
        // What comes back is the report of a process
        const report = await importVaccineWhodrugsService(req.file.buffer, data, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.importedSuccess', req.lang),
            data: report
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-007: Error importing Vaccine WHODrugs: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.importedFailed', req.lang), 500, 'WHODRUG_007_IMPORT_FAILED', error));
    }
}

// SPEC F54 — the five navigation controllers, ESAVI-WHODRUG-006A..006E.
// Unwraps the seven query parameters of the tree. Every ancestor is read raw, without trimming or
// normalizing: it carries a value this same API returned and it has to match it character by
// character — including the '__NULL__' sentinel, which is how the option with no value keeps its
// rows reachable. Which of them is required is the validator's business, not this function's
const readTreeFilters = (query: Request['query']): VaccineWhodrugTreeFilters => ({
    country: query.country ? (query.country as string).trim() : undefined,
    language: query.language ? (query.language as string).trim() : undefined,
    search: query.search ? (query.search as string).trim() : undefined,
    abbreviation: query.abbreviation !== undefined ? query.abbreviation as string : undefined,
    drugName: query.drugName !== undefined ? query.drugName as string : undefined,
    maHolders: query.maHolders !== undefined ? query.maHolders as string : undefined,
    formTranslations: query.formTranslations !== undefined ? query.formTranslations as string : undefined
});

// Get WHODrug Abbreviations Controller
// Code: ESAVI-WHODRUG-006A
const getWhodrugAbbreviations = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getWhodrugAbbreviationsService(readTreeFilters(req.query), req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.optionsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-006A: Error getting Vaccine WHODrug abbreviations: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.optionsFailed', req.lang), 500, 'WHODRUG_006A_FETCH_FAILED', error));
    }
}

// Get WHODrug Drug Names Controller
// Code: ESAVI-WHODRUG-006B
const getWhodrugDrugNames = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getWhodrugDrugNamesService(readTreeFilters(req.query), req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.optionsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-006B: Error getting Vaccine WHODrug drug names: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.optionsFailed', req.lang), 500, 'WHODRUG_006B_FETCH_FAILED', error));
    }
}

// Get WHODrug MA Holders Controller
// Code: ESAVI-WHODRUG-006C
const getWhodrugMaHolders = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getWhodrugMaHoldersService(readTreeFilters(req.query), req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.optionsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-006C: Error getting Vaccine WHODrug MA holders: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.optionsFailed', req.lang), 500, 'WHODRUG_006C_FETCH_FAILED', error));
    }
}

// Get WHODrug Forms Controller
// Code: ESAVI-WHODRUG-006D
const getWhodrugForms = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getWhodrugFormsService(readTreeFilters(req.query), req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.optionsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-006D: Error getting Vaccine WHODrug forms: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.optionsFailed', req.lang), 500, 'WHODRUG_006D_FETCH_FAILED', error));
    }
}

// Get WHODrug Strengths Controller
// Code: ESAVI-WHODRUG-006E
const getWhodrugStrengths = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getWhodrugStrengthsService(readTreeFilters(req.query), req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('vaccineWhodrug.optionsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODRUG-006E: Error getting Vaccine WHODrug strengths: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('vaccineWhodrug.optionsFailed', req.lang), 500, 'WHODRUG_006E_FETCH_FAILED', error));
    }
}

export {
    createVaccineWhodrug,
    getVaccineWhodrugs,
    getAllVaccineWhodrugs,
    getVaccineWhodrugById,
    updateVaccineWhodrug,
    deleteVaccineWhodrug,
    activateVaccineWhodrug,
    importVaccineWhodrugs,
    getWhodrugAbbreviations,
    getWhodrugDrugNames,
    getWhodrugMaHolders,
    getWhodrugForms,
    getWhodrugStrengths
};
