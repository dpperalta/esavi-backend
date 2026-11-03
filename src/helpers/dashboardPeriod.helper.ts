import { DASHBOARD_DEFAULT_PERIOD_DAYS, DASHBOARD_MAX_PERIOD_DAYS } from '../constants/dashboard.constants';
import { DashboardPeriod, DashboardPeriodQuery } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const todayIsoDate = (): string => {
    const now = new Date();
    const month = `${ now.getMonth() + 1 }`.padStart(2, '0');
    const day = `${ now.getDate() }`.padStart(2, '0');
    return `${ now.getFullYear() }-${ month }-${ day }`;
}

const toUtcMs = (isoDate: string): number => {
    const [year, month, day] = isoDate.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

const toIsoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const addDays = (isoDate: string, days: number): string => toIsoDate(toUtcMs(isoDate) + days * DAY_MS);

const daysBetweenInclusive = (from: string, to: string): number =>
    Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS) + 1;

export const isDashboardIsoDate = (value: unknown): value is string =>
    typeof value === 'string' && ISO_DATE_PATTERN.test(value) && toIsoDate(toUtcMs(value)) === value;

export const resolveDashboardPeriod = (
    query: DashboardPeriodQuery,
    today: string = todayIsoDate()
): { period: DashboardPeriod; previousPeriod: DashboardPeriod } => {
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -(DASHBOARD_DEFAULT_PERIOD_DAYS - 1));

    if( !isDashboardIsoDate(from) || !isDashboardIsoDate(to) ) {
        throw new RangeError('Dashboard period dates must be YYYY-MM-DD');
    }
    if( from > to ) {
        throw new RangeError('Dashboard period from is later than to');
    }
    if( to > today ) {
        throw new RangeError('Dashboard period to is in the future');
    }

    const days = daysBetweenInclusive(from, to);
    if( days > DASHBOARD_MAX_PERIOD_DAYS ) {
        throw new RangeError('Dashboard period exceeds the maximum range');
    }

    return {
        period: { from, to, days },
        previousPeriod: { from: addDays(from, -days), to: addDays(from, -1), days }
    };
}
