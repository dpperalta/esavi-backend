import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createVaccineWhodrugService } from '../services/vaccineWhodrug.service';

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

export {
    createVaccineWhodrug
};
