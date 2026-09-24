import {
    applyAppDetailsAuthors,
    collectAppDetailsUserIds,
    toPlainResponse
} from '../../src/helpers/appDetailsAuthors.helper';
import { CatalogType } from '../../src/models';

/**
 * The walk that finds and rewrites the audit authors of a response. The contract suite checks
 * the result over the wire for a few entities; which shapes of response are covered, and which
 * values become null, is fixed here once over the functions.
 */
const AUTHOR_A = '3f0c9a1e-2b4d-4c6e-8f10-111111111111';
const AUTHOR_B = '7a2e4c6f-8b1d-4e3a-9c50-222222222222';
const UNKNOWN = '9d8c7b6a-5f4e-4d3c-8b2a-333333333333';

const entry = (user: string) => ({
    createdAt: new Date('2026-09-01T10:00:00Z'),
    user,
    method: 'ESAVI-TEST-001',
    detail: 'Test entry'
});

const authors = new Map([ [ AUTHOR_A, 'ana@example.org' ], [ AUTHOR_B, 'bruno@example.org' ] ]);

describe('appDetails authors', () => {

    describe('collectAppDetailsUserIds', () => {

        it('finds audit arrays at the root, in { count, rows }, in includes and in composed objects', () => {
            const plain = {
                appDetails: [ entry(AUTHOR_A) ],
                rows: [ { appDetails: [ entry(AUTHOR_B) ] } ],
                patient: { notifier: { appDetails: [ entry(UNKNOWN) ] } }
            };
            expect(collectAppDetailsUserIds(plain).sort()).toEqual([ AUTHOR_A, AUTHOR_B, UNKNOWN ].sort());
        });

        it('collects a repeated author once', () => {
            const plain = { count: 2, rows: [ { appDetails: [ entry(AUTHOR_A), entry(AUTHOR_A) ] }, { appDetails: [ entry(AUTHOR_A) ] } ] };
            expect(collectAppDetailsUserIds(plain)).toEqual([ AUTHOR_A ]);
        });

        it('leaves out the literals that are not UUIDs, which would break the uuid IN', () => {
            expect(collectAppDetailsUserIds({ appDetails: [ { user: 'undefined' } ] })).toEqual([]);
            expect(collectAppDetailsUserIds({ appDetails: [ entry('unknown'), entry('undefined') ] })).toEqual([]);
        });

        it('ignores a property with audit-shaped entries under any other key', () => {
            expect(collectAppDetailsUserIds({ history: [ entry(AUTHOR_A) ] })).toEqual([]);
        });
    });

    describe('applyAppDetailsAuthors', () => {

        it('replaces a resolved author with the email and anything else with null', () => {
            const plain = { appDetails: [ entry(AUTHOR_A), entry(UNKNOWN), entry('undefined'), entry('unknown') ] };
            const result = applyAppDetailsAuthors(plain, authors) as { appDetails: { user: string | null }[] };
            expect(result.appDetails.map(item => item.user)).toEqual([ 'ana@example.org', null, null, null ]);
        });

        it('rewrites nested audit arrays and keeps order, length, createdAt, method and detail', () => {
            const plain = { rows: [ { caseData: { appDetails: [ entry(AUTHOR_B), entry(AUTHOR_A) ] } } ] };
            const result = applyAppDetailsAuthors(plain, authors) as typeof plain;
            const audit = result.rows[0].caseData.appDetails;
            expect(audit).toHaveLength(2);
            expect(audit[0]).toEqual({ ...entry(AUTHOR_B), user: 'bruno@example.org' });
            expect(audit[1]).toEqual({ ...entry(AUTHOR_A), user: 'ana@example.org' });
            expect(audit[0].createdAt).toBeInstanceOf(Date);
        });

        it('does not touch the same shape under another key', () => {
            const plain = { history: [ entry(AUTHOR_A) ] };
            const result = applyAppDetailsAuthors(plain, authors) as typeof plain;
            expect(result.history[0].user).toBe(AUTHOR_A);
        });

        it('does not descend into detail', () => {
            const nested = { ...entry(AUTHOR_A), detail: { appDetails: [ entry(AUTHOR_B) ] } };
            const result = applyAppDetailsAuthors({ appDetails: [ nested ] }, authors) as { appDetails: { detail: { appDetails: { user: string }[] } }[] };
            expect(result.appDetails[0].detail.appDetails[0].user).toBe(AUTHOR_B);
        });

        it('with an empty map, as for a reader without permission, leaves every user null', () => {
            const plain = { appDetails: [ entry(AUTHOR_A), entry(AUTHOR_B) ] };
            const result = applyAppDetailsAuthors(plain, new Map()) as { appDetails: { user: string | null }[] };
            expect(result.appDetails.every(item => item.user === null)).toBe(true);
        });
    });

    describe('toPlainResponse', () => {

        it('turns model instances into plain objects without mutating their stored history', () => {
            const instance = CatalogType.build({
                catalogTypeId: AUTHOR_B,
                code: 'testType',
                name: 'Test Type',
                appDetails: [ entry(AUTHOR_A) ]
            } as never);
            const plain = toPlainResponse({ count: 1, rows: [ instance ] }) as { rows: Record<string, unknown>[] };
            expect(plain.rows[0]).not.toBeInstanceOf(CatalogType);
            applyAppDetailsAuthors(plain, authors);
            expect((plain.rows[0].appDetails as { user: string }[])[0].user).toBe('ana@example.org');
            expect((instance.get('appDetails') as { user: string }[])[0].user).toBe(AUTHOR_A);
        });

        it('keeps Date instances as Date', () => {
            const plain = toPlainResponse({ appDetails: [ entry(AUTHOR_A) ] }) as { appDetails: { createdAt: unknown }[] };
            expect(plain.appDetails[0].createdAt).toBeInstanceOf(Date);
        });
    });
});
