import { Request, Response, NextFunction } from 'express';
import { AppError, canViewInactive, esaviLog, getMessage } from '../helpers';
import {
    createInvestigationTeamMemberService,
    getAllInvestigationTeamMembersByInvestigationService,
    getInvestigationTeamMemberByIdService,
    getInvestigationTeamMembersByCaseIdService,
    getInvestigationTeamMembersByInvestigationService,
    updateInvestigationTeamMemberService
} from '../services/investigationTeamMember.service';

// The only two things the three listings read from the query. There is no filter to unwrap: every
// listing returns the whole team of its parent, ordered by sortOrder
const pagination = (req: Request) => ({
    limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string) : undefined
});

// Create Investigation Team Member Controller
// Code: ESAVI-INVTEAM-001
const createInvestigationTeamMember = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createInvestigationTeamMemberService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('investigationTeamMember.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-001: Error creating Investigation Team Member: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.createdFailed', req.lang), 500, 'INVTEAM_001_CREATION_FAILED', error));
    }
}

// Get Investigation Team Members By Investigation Controller
// Code: ESAVI-INVTEAM-002A
const getInvestigationTeamMembersByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const { limit, offset } = pagination(req);
    try {
        const data = await getInvestigationTeamMembersByInvestigationService(id, req.lang, canViewInactive(req.user), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationTeamMember.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-002A: Error fetching Investigation Team Members: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.getFailedPlural', req.lang), 500, 'INVTEAM_002A_FETCH_FAILED', error));
    }
}

// Get All Investigation Team Members By Investigation Controller - For Admin
// Code: ESAVI-INVTEAM-002B
const getAllInvestigationTeamMembersByInvestigation = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    const { limit, offset } = pagination(req);
    try {
        const data = await getAllInvestigationTeamMembersByInvestigationService(id, req.lang, canViewInactive(req.user), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationTeamMember.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-002B: Error fetching all Investigation Team Members: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.getFailedPlural', req.lang), 500, 'INVTEAM_002B_FETCH_FAILED', error));
    }
}

// Get Investigation Team Member By ID Controller
// Code: ESAVI-INVTEAM-003
const getInvestigationTeamMemberById = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await getInvestigationTeamMemberByIdService(id, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationTeamMember.getSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-003: Error fetching Investigation Team Member: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.getFailed', req.lang), 500, 'INVTEAM_003_FETCH_FAILED', error));
    }
}

// Get Investigation Team Members By Case Controller
// Code: ESAVI-INVTEAM-006
const getInvestigationTeamMembersByCaseId = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const caseId = (req.params.caseId).toString().trim();
    const { limit, offset } = pagination(req);
    try {
        const data = await getInvestigationTeamMembersByCaseIdService(caseId, req.lang, canViewInactive(req.user), limit, offset);
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationTeamMember.getSuccessPlural', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-006: Error fetching Investigation Team Members by case: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.getFailedPlural', req.lang), 500, 'INVTEAM_006_FETCH_FAILED', error));
    }
}

// Update Investigation Team Member Controller
// Code: ESAVI-INVTEAM-004
const updateInvestigationTeamMember = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    const id = (req.params.id).toString().trim();
    try {
        const data = await updateInvestigationTeamMemberService(id, req.body, req.user, req.lang, canViewInactive(req.user));
        return res.status(200).json({
            ok: true,
            message: getMessage('investigationTeamMember.updatedSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-INVTEAM-004: Error updating Investigation Team Member: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('investigationTeamMember.updatedFailed', req.lang), 500, 'INVTEAM_004_UPDATE_FAILED', error));
    }
}

export {
    createInvestigationTeamMember,
    updateInvestigationTeamMember,
    getInvestigationTeamMemberById,
    getInvestigationTeamMembersByCaseId,
    getInvestigationTeamMembersByInvestigation,
    getAllInvestigationTeamMembersByInvestigation
};

