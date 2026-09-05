import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { getAllWhodrugProductsService } from '../services/whodrugProduct.service';
import { WhodrugProductListFilters } from '../types';

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

export {
    getAllWhodrugProducts
};
