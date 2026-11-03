import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { getPendingWorkService } from '../services/dashboard.service';

// Get Dashboard Pending Work Controller
// Code: ESAVI-DASH-006
const getPendingWork = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await getPendingWorkService(req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('dashboard.pendingWorkSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DASH-006: Error fetching dashboard pending work: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('dashboard.pendingWorkFailed', req.lang), 500, 'DASH_006_FETCH_FAILED', error));
    }
}

export {
    getPendingWork
}
