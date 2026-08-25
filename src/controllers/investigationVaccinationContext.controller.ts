import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationVaccinationContextService
} from '../services/investigationVaccinationContext.service';

// Create Investigation Vaccination Context Controller
// Code: ESAVI-INVVACTX-001
const createInvestigationVaccinationContext = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationVaccinationContextService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationVaccinationContext.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACTX-001: Error creating Investigation Vaccination Context: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccinationContext.createdFailed', req.lang), 500, 'INVVACTX_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationVaccinationContext
};
