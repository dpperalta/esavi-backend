import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationVaccineAdministeredService
} from '../services/investigationVaccineAdministered.service';

// Create Investigation Vaccine Administered Controller
// Code: ESAVI-INVVACAD-001
const createInvestigationVaccineAdministered = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationVaccineAdministeredService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationVaccineAdministered.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVVACAD-001: Error creating Investigation Vaccine Administered: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationVaccineAdministered.createdFailed', req.lang), 500, 'INVVACAD_001_CREATION_FAILED', error));
    }
}

export {
    createInvestigationVaccineAdministered
}
