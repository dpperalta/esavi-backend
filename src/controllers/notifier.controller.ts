import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { createNotifierService } from '../services/notifier.service';

// Create Notifier Controller
// Code: ESAVI-NOTIFIER-001
const createNotifier = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const data = await createNotifierService(req.body, req.user, req.lang);
        return res.status(201).json({
            ok: true,
            message: getMessage('notifier.createdSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-NOTIFIER-001: Error creating Notifier: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('notifier.createdFailed', req.lang), 500, 'NOTIFIER_001_CREATION_FAILED', error));
    }
}

export {
    createNotifier
}
