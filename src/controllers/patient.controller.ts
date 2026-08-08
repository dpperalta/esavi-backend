import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createPatientService } from '../services/patient.service';

// Create Patient Controller
// Code: ESAVI-PATIENT-001
const createPatient = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createPatientService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('patient.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PATIENT-001: Error creating Patient: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('patient.createdFailed', req.lang), 500, 'PATIENT_001_CREATION_FAILED', error));
    }
}

export {
    createPatient
}
