import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser, InvestigationAdministrationErrorListFilters } from '../types';
import {
    createInvestigationAdministrationErrorService,
    getAllInvestigationAdministrationErrorsService,
    getInvestigationAdministrationErrorByIdService,
    getInvestigationAdministrationErrorsService
} from '../services/investigationAdministrationError.service';

// The two query filters of 002A and 002B. Only what actually arrives travels to the service, so an
// absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): InvestigationAdministrationErrorListFilters => ({
    investigationId: req.query.investigationId as string | undefined,
    caseId: req.query.caseId as string | undefined
});

// Create Investigation Administration Error Controller
// Code: ESAVI-INVADMER-001
const createInvestigationAdministrationError = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationAdministrationErrorService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationAdministrationError.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVADMER-001: Error creating Investigation Administration Error: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAdministrationError.createdFailed', req.lang), 500, 'INVADMER_001_CREATION_FAILED', error));
    }
}

// Get Investigation Administration Errors Controller
// Code: ESAVI-INVADMER-002A
const getInvestigationAdministrationErrors = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getInvestigationAdministrationErrorsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationAdministrationError.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVADMER-002A: Error fetching Investigation Administration Errors: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAdministrationError.getFailedPlural', req.lang), 500, 'INVADMER_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Administration Errors Controller - For Admin
// Code: ESAVI-INVADMER-002B
const getAllInvestigationAdministrationErrors = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllInvestigationAdministrationErrorsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationAdministrationError.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVADMER-002B: Error fetching all Investigation Administration Errors: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAdministrationError.getFailedPlural', req.lang), 500, 'INVADMER_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Administration Error By ID Controller
// Code: ESAVI-INVADMER-003
// canViewInactive is what lets a SUPERADMIN read the administration error of a retired
// investigation: the entity has no state of its own, so the predicate is applied over the visibility
// it inherits
const getInvestigationAdministrationErrorById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const { id } = req.params;
    try {
        const data = await getInvestigationAdministrationErrorByIdService(
            id.toString().trim(),
            req.lang,
            canViewInactive(req.user as AuthUser)
        );
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationAdministrationError.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVADMER-003: Error fetching Investigation Administration Error: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationAdministrationError.getFailed', req.lang), 500, 'INVADMER_003_FETCH_FAILED', error));
    }
}

export {
    createInvestigationAdministrationError,
    getAllInvestigationAdministrationErrors,
    getInvestigationAdministrationErrorById,
    getInvestigationAdministrationErrors
};
