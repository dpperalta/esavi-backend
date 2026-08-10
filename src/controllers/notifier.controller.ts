import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { NotifierListFilters } from '../types';
import {
    createNotifierService,
    getAllNotifiersService,
    getNotifiersService
} from '../services/notifier.service';

// The three query filters of 002A and 002B. Only what actually arrives travels to the service,
// so an absent filter never turns into an `undefined` in the where clause
const listFilters = (req: Request): NotifierListFilters => ({
    caseId: req.query.caseId as string | undefined,
    professionItemId: req.query.professionItemId as string | undefined,
    geoLocationId: req.query.geoLocationId as string | undefined
});

// Create Notifier Controller
// Code: ESAVI-NOTIFIER-001
const createNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotifierService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notifier.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-001: Error creating Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.createdFailed', req.lang), 500, 'NOTIFIER_001_CREATION_FAILED', error));
    }
}

// Get Notifiers Controller
// Code: ESAVI-NOTIFIER-002A
const getNotifiers = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getNotifiersService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-002A: Error fetching Notifiers: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.getFailedPlural', req.lang), 500, 'NOTIFIER_002A_FETCH_FAILED', error));
    }
}

// Get All Notifiers Controller - For Admin
// Code: ESAVI-NOTIFIER-002B
const getAllNotifiers = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllNotifiersService(listFilters(req), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('notifier.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-002B: Error fetching all Notifiers: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.getFailedPlural', req.lang), 500, 'NOTIFIER_002B_FETCH_FAILED', error));
    }
}

export {
    createNotifier,
    getNotifiers,
    getAllNotifiers
}
