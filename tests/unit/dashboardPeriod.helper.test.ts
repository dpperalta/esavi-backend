import { resolveDashboardPeriod } from '../../src/helpers/dashboardPeriod.helper';

const TODAY = '2026-11-03';

describe('resolveDashboardPeriod', () => {

    it('defaults to the 30 days ending today and the 30 before them', () => {
        expect(resolveDashboardPeriod({}, TODAY)).toEqual({
            period: { from: '2026-10-05', to: '2026-11-03', days: 30 },
            previousPeriod: { from: '2026-09-05', to: '2026-10-04', days: 30 }
        });
    });

    it('derives from as to minus 29 when only to travels', () => {
        const { period } = resolveDashboardPeriod({ to: '2026-03-31' }, TODAY);
        expect(period).toEqual({ from: '2026-03-02', to: '2026-03-31', days: 30 });
    });

    it('ends the period today when only from travels', () => {
        const { period } = resolveDashboardPeriod({ from: '2026-11-01' }, TODAY);
        expect(period).toEqual({ from: '2026-11-01', to: TODAY, days: 3 });
    });

    it('resolves the previous period of January as the whole of December', () => {
        expect(resolveDashboardPeriod({ from: '2026-01-01', to: '2026-01-31' }, TODAY)).toEqual({
            period: { from: '2026-01-01', to: '2026-01-31', days: 31 },
            previousPeriod: { from: '2025-12-01', to: '2025-12-31', days: 31 }
        });
    });

    it('accepts a single-day period', () => {
        const { period, previousPeriod } = resolveDashboardPeriod({ from: '2026-03-01', to: '2026-03-01' }, TODAY);
        expect(period.days).toBe(1);
        expect(previousPeriod).toEqual({ from: '2026-02-28', to: '2026-02-28', days: 1 });
    });

    it('accepts exactly 366 days', () => {
        const { period } = resolveDashboardPeriod({ from: '2025-11-03', to: '2026-11-03' }, TODAY);
        expect(period.days).toBe(366);
    });

    it('rejects 367 days', () => {
        expect(() => resolveDashboardPeriod({ from: '2025-11-02', to: '2026-11-03' }, TODAY)).toThrow(RangeError);
    });

    it('rejects from later than to', () => {
        expect(() => resolveDashboardPeriod({ from: '2026-05-01', to: '2026-04-01' }, TODAY)).toThrow(RangeError);
    });

    it('rejects a future to', () => {
        expect(() => resolveDashboardPeriod({ to: '2026-11-04' }, TODAY)).toThrow(RangeError);
    });

    it('rejects a from after today when to is defaulted', () => {
        expect(() => resolveDashboardPeriod({ from: '2026-11-04' }, TODAY)).toThrow(RangeError);
    });

    it('rejects a malformed or impossible date', () => {
        expect(() => resolveDashboardPeriod({ from: '2026-02-30' }, TODAY)).toThrow(RangeError);
        expect(() => resolveDashboardPeriod({ to: '2026-3-1' }, TODAY)).toThrow(RangeError);
    });
});
