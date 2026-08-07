import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createAppRoleService } from '../services/appRole.service';

// Create App Role Controller
// Code: ESAVI-APPROLE-001
const createAppRole = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createAppRoleService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('appRole.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-APPROLE-001: Error creating App Role: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('appRole.createdFailed', req.lang), 500, 'APPROLE_001_CREATION_FAILED', error));
    }
}

export {
    createAppRole
}
