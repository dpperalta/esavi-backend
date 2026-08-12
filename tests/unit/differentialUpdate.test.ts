import { buildDifferentialUpdate } from '../../src/helpers/differentialUpdate.helper';

/**
 * The comparison rules of `buildDifferentialUpdate` are the criterion of the twelve update
 * services, and none of them is observable from an endpoint: an HTTP case only tells apart
 * "it wrote" from "it did not write", never which rule decided it. They are verified here once
 * over the function instead of twelve times over the wire.
 */
describe('buildDifferentialUpdate', () => {

    describe('comparison rules', () => {

        it('compares primitives strictly', () => {
            expect(buildDifferentialUpdate({ sortOrder: 3 }, { sortOrder: 3 })).toEqual({});
            expect(buildDifferentialUpdate({ sortOrder: 3 }, { sortOrder: 4 })).toEqual({ sortOrder: 4 });
            // A boolean arriving false is a value, not an absence
            expect(buildDifferentialUpdate({ isSeriousEvent: true }, { isSeriousEvent: false })).toEqual({ isSeriousEvent: false });
        });

        it('treats null on one side and a value on the other as a change', () => {
            expect(buildDifferentialUpdate({ notes: null }, { notes: null })).toEqual({});
            expect(buildDifferentialUpdate({ notes: null }, { notes: 'Something' })).toEqual({ notes: 'Something' });
            // Emptying a nullable column is a change, and the only way to express it
            expect(buildDifferentialUpdate({ notes: 'Something' }, { notes: null })).toEqual({ notes: null });
        });

        it('compares dates by their timestamp, whichever side is a Date instance', () => {
            const stored = new Date('2026-03-04T05:06:07.000Z');

            expect(buildDifferentialUpdate({ validFrom: stored }, { validFrom: '2026-03-04T05:06:07.000Z' })).toEqual({});
            expect(buildDifferentialUpdate({ validFrom: stored }, { validFrom: new Date('2026-03-04T05:06:07.000Z') })).toEqual({});
            expect(buildDifferentialUpdate({ validFrom: '2026-03-04T05:06:07.000Z' }, { validFrom: stored })).toEqual({});

            const moved = new Date('2026-03-05T05:06:07.000Z');
            expect(buildDifferentialUpdate({ validFrom: stored }, { validFrom: moved })).toEqual({ validFrom: moved });
        });

        it('compares objects and arrays by their serialization', () => {
            expect(buildDifferentialUpdate({ sysDetails: { version: 2 } }, { sysDetails: { version: 2 } })).toEqual({});
            expect(buildDifferentialUpdate({ tags: [ 'a', 'b' ] }, { tags: [ 'a', 'b' ] })).toEqual({});
            expect(buildDifferentialUpdate({ tags: [ 'a', 'b' ] }, { tags: [ 'b', 'a' ] })).toEqual({ tags: [ 'b', 'a' ] });
        });

        it('compares a numeric string against a number numerically', () => {
            // The DECIMAL(10, 7) of geoLocation and healthFacility: `pg` has no type parser
            // configured in this repository, so latitude reads back as a string
            expect(buildDifferentialUpdate({ latitude: '-0.2299000' }, { latitude: -0.2299 })).toEqual({});
            expect(buildDifferentialUpdate({ longitude: '-78.5249500' }, { longitude: -78.52495 })).toEqual({});
            expect(buildDifferentialUpdate({ latitude: '-0.2299000' }, { latitude: -0.23 })).toEqual({ latitude: -0.23 });
            // Neither the empty string nor a boolean is a number, however they coerce
            expect(buildDifferentialUpdate({ latitude: 0 }, { latitude: '' })).toEqual({ latitude: '' });
            expect(buildDifferentialUpdate({ isSeriousEvent: 1 }, { isSeriousEvent: true })).toEqual({ isSeriousEvent: true });
        });

        it('compares a DATEONLY column by its calendar day', () => {
            expect(buildDifferentialUpdate({ firstConsultationDate: '2026-03-04' }, { firstConsultationDate: '2026-03-04' })).toEqual({});
            expect(buildDifferentialUpdate({ firstConsultationDate: '2026-03-04' }, { firstConsultationDate: '2026-03-04T05:06:07.000Z' })).toEqual({});
            expect(buildDifferentialUpdate({ firstConsultationDate: '2026-03-04' }, { firstConsultationDate: '2026-03-05' }))
                .toEqual({ firstConsultationDate: '2026-03-05' });
            // Two timestamps of the same day are not the same instant: the rule only reaches
            // the columns that read back as a bare YYYY-MM-DD
            expect(buildDifferentialUpdate({ createdAt: '2026-03-04T05:00:00.000Z' }, { createdAt: '2026-03-04T09:00:00.000Z' }))
                .toEqual({ createdAt: '2026-03-04T09:00:00.000Z' });
        });

    });

    describe('edges', () => {

        it('discards undefined and keeps null: they are not interchangeable', () => {
            // undefined is "it did not travel in the body", null is "it travelled as null"
            expect(buildDifferentialUpdate({ validTo: '2026-03-04T00:00:00.000Z' }, { validTo: undefined })).toEqual({});
            expect(buildDifferentialUpdate({ validTo: null }, { validTo: undefined })).toEqual({});
            expect(buildDifferentialUpdate({ validTo: new Date('2026-03-04T00:00:00.000Z') }, { validTo: null })).toEqual({ validTo: null });
        });

        it('reports a change when the stored key is absent, which is why stored must be the whole row', () => {
            // An instance read with narrowed `attributes` reads back undefined for what it left
            // out, and the service would go back to writing on every request
            expect(buildDifferentialUpdate({}, { name: 'Ana' })).toEqual({ name: 'Ana' });
            expect(buildDifferentialUpdate({}, { name: null })).toEqual({ name: null });
            expect(buildDifferentialUpdate({}, { name: undefined })).toEqual({});
        });

        it('returns an empty object when nothing changed, which is the service cut', () => {
            const stored = { code: 'FEVER', name: 'Fever', sortOrder: 1, notes: null };

            expect(buildDifferentialUpdate(stored, {})).toEqual({});
            expect(buildDifferentialUpdate(stored, { code: 'FEVER', name: 'Fever', sortOrder: 1, notes: null })).toEqual({});
            expect(Object.keys(buildDifferentialUpdate(stored, { code: 'FEVER', name: 'Fever' })).length).toBe(0);
        });

    });

    it('does not mutate its arguments', () => {
        const stored = { code: 'FEVER' };
        const candidates = { code: 'RASH', name: undefined };

        buildDifferentialUpdate(stored, candidates);

        expect(stored).toEqual({ code: 'FEVER' });
        expect(candidates).toEqual({ code: 'RASH', name: undefined });
    });

});
