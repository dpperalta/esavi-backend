import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createInvestigationTeamMemberService } from '../services/investigationTeamMember.service';

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

export {
    createInvestigationTeamMember
};
