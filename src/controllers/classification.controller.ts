import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { ClassificationListFilters } from '../types';
import {
    createClassificationService,
    getAllClassificationsService,
    getClassificationsService
} from '../services/classification.service';

// The three query filters of 002A and 002B. Only what actually arrives travels to the service,
// so an absent filter never turns into an `undefined` in the where clause. isSeriousEvent comes
// off the query string, where everything is text: the validator already restricted it to a
// boolean, so comparing against 'true' is enough to read it
const listFilters = (req: Request): ClassificationListFilters => ({
    caseId: req.query.caseId as string | undefined,
    isSeriousEvent: req.query.isSeriousEvent !== undefined
        ? String(req.query.isSeriousEvent) === 'true' : undefined,
    ageUnitItemId: req.query.ageUnitItemId as string | undefined
});

// Create Classification Controller
// Code: ESAVI-CLASSIF-001
const createClassification = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createClassificationService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('classification.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CLASSIF-001: Error creating Classification: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('classification.createdFailed', req.lang), 500, 'CLASSIF_001_CREATION_FAILED', error));
    }
}

// Get Classifications Controller
// Code: ESAVI-CLASSIF-002A
const getClassifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getClassificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('classification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CLASSIF-002A: Error fetching Classifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('classification.getFailedPlural', req.lang), 500, 'CLASSIF_002A_FETCH_FAILED', error));
    }
}

// Get All Classifications Controller - For Admin
// Code: ESAVI-CLASSIF-002B
const getAllClassifications = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllClassificationsService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('classification.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-CLASSIF-002B: Error fetching Classifications: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('classification.getFailedPlural', req.lang), 500, 'CLASSIF_002B_FETCH_FAILED', error));
    }
}

export {
    createClassification,
    getClassifications,
    getAllClassifications
}
