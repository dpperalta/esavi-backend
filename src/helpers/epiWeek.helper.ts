import { EpiWeek } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const toUtcMs = (isoDate: string): number => {
    if( !ISO_DATE_PATTERN.test(isoDate) ) {
        throw new RangeError('Epidemiological week dates must be YYYY-MM-DD');
    }
    const [year, month, day] = isoDate.split('-').map(Number);
    const ms = Date.UTC(year, month - 1, day);
    if( toIsoDate(ms) !== isoDate ) {
        throw new RangeError('Epidemiological week dates must be YYYY-MM-DD');
    }
    return ms;
}

const toIsoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const weekStartMs = (ms: number): number => ms - new Date(ms).getUTCDay() * DAY_MS;

const fromWeekStartMs = (startMs: number): EpiWeek => {
    const epiYear = new Date(startMs + 3 * DAY_MS).getUTCFullYear();
    const firstWeekStartMs = weekStartMs(Date.UTC(epiYear, 0, 4));
    const epiWeek = Math.round((startMs - firstWeekStartMs) / (7 * DAY_MS)) + 1;
    return {
        epiYear,
        epiWeek,
        label: `${ epiYear }-SE${ `${ epiWeek }`.padStart(2, '0') }`,
        weekStart: toIsoDate(startMs)
    };
}

export const getEpiWeek = (date: string): EpiWeek => fromWeekStartMs(weekStartMs(toUtcMs(date)));

export const listEpiWeeks = (from: string, to: string): EpiWeek[] => {
    const firstMs = weekStartMs(toUtcMs(from));
    const lastMs = weekStartMs(toUtcMs(to));
    const weeks: EpiWeek[] = [];
    for( let ms = firstMs; ms <= lastMs; ms += 7 * DAY_MS ) {
        weeks.push(fromWeekStartMs(ms));
    }
    return weeks;
}
