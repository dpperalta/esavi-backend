import { resolveAgeAtEvent } from '../../src/helpers/age.helper';

// The borders of the calendar arithmetic. They live in a unit suite and not in the contract one
// because covering them over HTTP would mean minting a patient and a case per assertion, and
// what is under test here is arithmetic, not an endpoint
describe('resolveAgeAtEvent', () => {

    describe('unit boundaries', () => {

        it('returns 0 DAYS when the event happens on the day of birth', () => {
            expect(resolveAgeAtEvent('2025-03-10', '2025-03-10')).toEqual({ age: 0, unitCode: 'DAYS' });
        });

        it('returns 30 DAYS one day short of a completed month', () => {
            expect(resolveAgeAtEvent('2025-01-01', '2025-01-31')).toEqual({ age: 30, unitCode: 'DAYS' });
        });

        it('returns 1 MONTHS on an exact month, not 30 DAYS', () => {
            expect(resolveAgeAtEvent('2025-01-01', '2025-02-01')).toEqual({ age: 1, unitCode: 'MONTHS' });
        });

        it('returns 11 MONTHS at eleven months and twenty-nine days', () => {
            expect(resolveAgeAtEvent('2024-01-01', '2024-12-30')).toEqual({ age: 11, unitCode: 'MONTHS' });
        });

        it('returns 1 YEARS on exactly twelve months, not 12 MONTHS', () => {
            expect(resolveAgeAtEvent('2024-01-01', '2025-01-01')).toEqual({ age: 1, unitCode: 'YEARS' });
        });

        it('uses calendar arithmetic: 29 February to 28 February is 11 MONTHS, not a year', () => {
            expect(resolveAgeAtEvent('2024-02-29', '2025-02-28')).toEqual({ age: 11, unitCode: 'MONTHS' });
        });
    });

    describe('typical ages', () => {

        it('resolves three years in YEARS', () => {
            expect(resolveAgeAtEvent('2020-05-04', '2023-05-04')).toEqual({ age: 3, unitCode: 'YEARS' });
        });

        it('resolves seven months in MONTHS', () => {
            expect(resolveAgeAtEvent('2025-01-15', '2025-08-15')).toEqual({ age: 7, unitCode: 'MONTHS' });
        });

        it('resolves twelve days in DAYS', () => {
            expect(resolveAgeAtEvent('2025-06-01', '2025-06-13')).toEqual({ age: 12, unitCode: 'DAYS' });
        });
    });

    describe('missing dates', () => {

        it('returns null when the birth date is missing', () => {
            expect(resolveAgeAtEvent(null, '2025-06-13')).toBeNull();
            expect(resolveAgeAtEvent(undefined, '2025-06-13')).toBeNull();
        });

        it('returns null when the event date is missing', () => {
            expect(resolveAgeAtEvent('2025-06-01', null)).toBeNull();
            expect(resolveAgeAtEvent('2025-06-01', undefined)).toBeNull();
        });

        it('returns null when a date is not readable', () => {
            expect(resolveAgeAtEvent('not-a-date', '2025-06-13')).toBeNull();
        });
    });

    describe('invalid range', () => {

        it('throws when the event precedes the birth', () => {
            expect(() => resolveAgeAtEvent('2025-06-13', '2025-06-01')).toThrow();
        });

        it('throws even when the event precedes the birth by a single day', () => {
            expect(() => resolveAgeAtEvent('2025-06-13', '2025-06-12')).toThrow();
        });
    });

    describe('Date instances', () => {

        // Sequelize gives DATEONLY back as a string, but a caller holding a Date must read the
        // same day: the UTC getters are what guarantee it west of Greenwich
        it('reads a Date the same way as its ISO string', () => {
            expect(resolveAgeAtEvent(new Date('2020-05-04'), new Date('2023-05-04')))
                .toEqual({ age: 3, unitCode: 'YEARS' });
        });
    });
});
