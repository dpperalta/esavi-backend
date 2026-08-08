import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import { AuthUser } from '../types';
import {
    createPatientService,
    getAllPatientsService,
    getPatientByIdService,
    getPatientsService
} from '../services/patient.service';

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

// Get Patients Controller
// Code: ESAVI-PATIENT-002A
const getPatients = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getPatientsService(limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('patient.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PATIENT-002A: Error fetching Patients: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('patient.getFailedPlural', req.lang), 500, 'PATIENT_002A_FETCH_FAILED', error));
    }
}

// Get All Patients Controller - For Admin
// Code: ESAVI-PATIENT-002B
const getAllPatients = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
    try {
        const data = await getAllPatientsService(limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('patient.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PATIENT-002B: Error fetching all Patients: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('patient.getFailedPlural', req.lang), 500, 'PATIENT_002B_FETCH_FAILED', error));
    }
}

// Get Patient By ID Controller
// Code: ESAVI-PATIENT-003
const getPatientById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getPatientByIdService(id, req.lang, canViewInactive(req.user as AuthUser));
        return res.status(200).json({
            ok: true,
            message: getMessage('patient.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-PATIENT-003: Error fetching Patient by ID: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('patient.getFailed', req.lang), 500, 'PATIENT_003_FETCH_FAILED', error));
    }
}

export {
    createPatient,
    getPatients,
    getAllPatients,
    getPatientById
}
