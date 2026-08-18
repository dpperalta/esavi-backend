import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createDiluentCatalogService } from '../services/diluentCatalog.service';

// Create Diluent Catalog Controller
// Code: ESAVI-DILUENT-001
const createDiluentCatalog = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createDiluentCatalogService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('diluentCatalog.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DILUENT-001: Error creating Diluent Catalog: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('diluentCatalog.createdFailed', req.lang), 500, 'DILUENT_001_CREATION_FAILED', error));
    }
}

export {
    createDiluentCatalog
};
