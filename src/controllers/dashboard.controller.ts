import { Request, Response, NextFunction } from 'express';
import { AppError, esaviLog, getMessage } from '../helpers';
import { getEpiCurveService, getIndicatorsService, getPendingWorkService } from '../services/dashboard.service';
import { DashboardPeriodQuery } from '../types';

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

// Get Dashboard Indicators Controller
// Code: ESAVI-DASH-007
const getIndicators = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const { from, to, geoLocationId } = req.query as DashboardPeriodQuery;
        const data = await getIndicatorsService({ from, to, geoLocationId }, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('dashboard.indicatorsSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DASH-007: Error fetching dashboard indicators: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('dashboard.indicatorsFailed', req.lang), 500, 'DASH_007_FETCH_FAILED', error));
    }
}

// Get Dashboard Epi Curve Controller
// Code: ESAVI-DASH-008
const getEpiCurve = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
    try {
        const { from, to, geoLocationId } = req.query as DashboardPeriodQuery;
        const data = await getEpiCurveService({ from, to, geoLocationId }, req.user, req.lang);
        return res.status(200).json({
            ok: true,
            message: getMessage('dashboard.epiCurveSuccess', req.lang),
            data
        });
    } catch (error) {
        esaviLog('ESAVI-DASH-008: Error fetching dashboard epi curve: ' + error, 'error');
        if( error instanceof AppError ) {
            next(error);
            return;
        }
        next(new AppError(getMessage('dashboard.epiCurveFailed', req.lang), 500, 'DASH_008_FETCH_FAILED', error));
    }
}

export {
    getEpiCurve,
    getIndicators,
    getPendingWork
}
