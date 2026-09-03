import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { searchMeddraTermsService } from '../services/meddra.service';

// Code: ESAVI-MEDDRA-006
const searchMeddraTerms = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    // `term` is the only parameter the client controls. The whole search body — version, take, the
    // level flags — lives in ESAVI_MEDDRA_SEARCH_CONFIG and is not open to the query string
    const term = (req.query.term as string).trim();
    try {
        const data = await searchMeddraTermsService(term, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('meddra.searchSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-MEDDRA-006: Error searching MedDRA terms: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('meddra.searchFailed', req.lang), 500, 'MEDDRA_006_SEARCH_FAILED', error));
    }
}

export {
    searchMeddraTerms
}
