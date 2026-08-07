import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { assignAppUserRoleService } from '../services/appUserRole.service';

// Assign App User Role Controller
// Code: ESAVI-USERROLE-001
const assignAppUserRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        // A new pair is a 201; an existing but revoked pair is reactivated and answers 200.
        // The client never knows the userRoleId of a revoked row, so it cannot be asked to
        // reach for PATCH /activate/:id instead
        const { assignment, created } = await assignAppUserRoleService(req.body, req.user, req.lang);
        return res.status(created ? 201 : 200).json({
            ok: true,
            message: getMessage(created ? 'appUserRole.assignSuccess' : 'appUserRole.reactivateSuccess', req.lang),
            data: assignment
        });
    } catch (error) {
        esaviLog('ESAVI-USERROLE-001: Error assigning App User Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appUserRole.assignFailed', req.lang), 500, 'USERROLE_001_ASSIGN_FAILED', error));
    }
}

export {
    assignAppUserRole
};
