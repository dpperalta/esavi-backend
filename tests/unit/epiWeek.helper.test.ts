import { getEpiWeek, listEpiWeeks } from '../../src/helpers/epiWeek.helper';

describe('getEpiWeek', () => {

    it('places Sunday 2026-01-04 in 2026-SE01', () => {
        expect(getEpiWeek('2026-01-04')).toEqual({
            epiYear: 2026, epiWeek: 1, label: '2026-SE01', weekStart: '2026-01-04'
        });
    });

    it('places Thursday 2026-01-01 in the last week of the previous epidemiological year', () => {
        expect(getEpiWeek('2026-01-01')).toEqual({
            epiYear: 2025, epiWeek: 53, label: '2025-SE53', weekStart: '2025-12-28'
        });
    });

    it('places Tuesday 2024-12-31 in the first week of the next epidemiological year', () => {
        expect(getEpiWeek('2024-12-31')).toEqual({
            epiYear: 2025, epiWeek: 1, label: '2025-SE01', weekStart: '2024-12-29'
        });
    });

    it('places 2026-04-01 in 2026-SE13', () => {
        expect(getEpiWeek('2026-04-01')).toEqual({
            epiYear: 2026, epiWeek: 13, label: '2026-SE13', weekStart: '2026-03-29'
        });
    });

    it('maps every day of a week, Sunday to Saturday, to the same week', () => {
        const labels = [ '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04' ]
            .map(( day ) => getEpiWeek(day).label );
        expect(new Set(labels)).toEqual(new Set([ '2026-SE13' ]));
        expect(getEpiWeek('2026-04-05').label).toBe('2026-SE14');
    });

    it('rejects a value that is not a real YYYY-MM-DD date', () => {
        expect(() => getEpiWeek('2026-02-30')).toThrow(RangeError);
        expect(() => getEpiWeek('2026-1-4')).toThrow(RangeError);
    });
});

describe('listEpiWeeks', () => {

    it('returns the 53 weeks of epidemiological year 2025, from 2024-12-29 to 2025-12-27', () => {
        const weeks = listEpiWeeks('2024-12-29', '2026-01-03');
        expect(weeks).toHaveLength(53);
        expect(weeks[0]).toEqual({ epiYear: 2025, epiWeek: 1, label: '2025-SE01', weekStart: '2024-12-29' });
        expect(weeks[52]).toEqual({ epiYear: 2025, epiWeek: 53, label: '2025-SE53', weekStart: '2025-12-28' });
        expect(weeks[51].weekStart).toBe('2025-12-21');
        expect(weeks.map(( week ) => week.epiWeek )).toEqual(Array.from({ length: 53 }, ( _, i ) => i + 1));
    });

    it('lists the weeks a period touches, continuous and ordered', () => {
        expect(listEpiWeeks('2026-01-01', '2026-01-28').map(( week ) => week.label )).toEqual([
            '2025-SE53', '2026-SE01', '2026-SE02', '2026-SE03', '2026-SE04'
        ]);
    });

    it('returns a single week when both ends fall in it', () => {
        expect(listEpiWeeks('2026-04-01', '2026-04-02')).toHaveLength(1);
    });
});
