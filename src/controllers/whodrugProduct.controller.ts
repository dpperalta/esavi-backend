import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { getAllWhodrugProductsService, searchWhodrugProductsService, syncWhodrugProductsService } from '../services/whodrugProduct.service';
import { SyncWhodrugProductsInput, WhodrugProductListFilters } from '../types';
import { WHODRUG_SEARCH_DEFAULT_LIMIT } from '../constants/whodrug.constants';

const readAdminListFilters = (query: Request['query']): WhodrugProductListFilters => ({
    name: query.name ? (query.name as string).trim() : undefined,
    ingredient: query.ingredient ? (query.ingredient as string).trim() : undefined,
    limit: query.limit ? parseInt(query.limit as string) : undefined,
    offset: query.offset ? parseInt(query.offset as string) : undefined
});

// List Whodrug Products For Inspection Controller (raw mirror, admin only)
// Code: ESAVI-WHODPROD-002B
const getAllWhodrugProducts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getAllWhodrugProductsService(readAdminListFilters(req.query));
        return res.status(200).json({
            ok: true,
            message: getMessage('whodrugProduct.listed', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODPROD-002B: Error listing WHODrug products: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('whodrugProduct.fetchFailed', req.lang), 500, 'WHODPROD_002B_FETCH_FAILED', error));
    }
}

// Sync Whodrug Products Controller — downloads the standard, writes the mirror
// Code: ESAVI-WHODPROD-007
const syncWhodrugProducts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data: SyncWhodrugProductsInput = {
        dictionaryVersion: body.dictionaryVersion ? (body.dictionaryVersion as string).trim() : undefined,
        dryRun: body.dryRun as boolean | undefined
    };
    try {
        // 200 and not 201: what comes back is the report of a process, not a created resource
        const report = await syncWhodrugProductsService(data, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('whodrugProduct.synced', req.lang),
            data: report
        });
    } catch (error) {
        esaviLog('ESAVI-WHODPROD-007: Error syncing WHODrug products: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('whodrugProduct.syncFailed', req.lang), 500, 'WHODPROD_007_SYNC_FAILED', error));
    }
}

// Search Whodrug Products Controller (concomitant medication autocomplete)
// Code: ESAVI-WHODPROD-006
const searchWhodrugProducts = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    // term is the only parameter the client controls. The country and the excluded ATC prefixes
    // are policy, resolved by the service from systemConfig — not open to the query string
    const term = (req.query.term as string).trim();
    const limit = req.query.limit ? parseInt(req.query.limit as string) : WHODRUG_SEARCH_DEFAULT_LIMIT;
    try {
        const data = await searchWhodrugProductsService(term, limit, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('whodrugProduct.searched', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-WHODPROD-006: Error searching WHODrug products: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('whodrugProduct.searchFailed', req.lang), 500, 'WHODPROD_006_FETCH_FAILED', error));
    }
}

export {
    getAllWhodrugProducts,
    searchWhodrugProducts,
    syncWhodrugProducts
};
