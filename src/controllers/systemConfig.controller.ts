import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createSystemConfigService } from '../services/systemConfig.service';

// Create System Config Controller
// Code: ESAVI-SYSCONF-001
const createSystemConfig = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createSystemConfigService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('systemConfig.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-SYSCONF-001: Error creating System Config: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('systemConfig.createdFailed', req.lang), 500, 'SYSCONF_001_CREATION_FAILED', error));
    }
}

export {
    createSystemConfig
}
