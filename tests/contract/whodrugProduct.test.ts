import request from 'supertest';
import { Op, QueryTypes } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { WhodrugProduct } from '../../src/models';
import { encryptSystemConfigValue } from '../../src/helpers/systemConfigValue.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, getTestUser, authHeader } from '../setup/auth';
import { syncWhodrugProductsService } from '../../src/services/whodrugProduct.service';
import { AuthUser } from '../../src/types';

/**
 * Contract suite for SPEC F56 — the raw mirror of the WHODrug standard and the concomitant
 * medication search built on top of it.
 *
 * NO TEST GOES OUT TO THE NETWORK. `global.fetch` is the seam, exactly as `meddra.test.ts` does
 * it for its own licensed API. The configuration travels through the real chain: the seven rows
 * of scope WHODRUG that `globalSetup` already seeded through ESAVI-SYSCONF-008 are rewritten here
 * with raw SQL, the same way `tests/setup/database.ts` does for MAIL.
 *
 * There is no `004`, no `PUT` and no `005A`/`005B` for this entity: the sync (`007`) is the only
 * write door, so the differential-update contract is exercised on its update branch instead of on
 * a canonical `PUT`, per SPEC F56 §5's own mapping of the five canonical criteria.
 */
describe('whodrugProduct contract', () => {

    const downloadUrl = 'https://whodrug.test/regional-drugs';
    const suffix = Date.now().toString(36).toUpperCase();

    let consoleError: jest.SpyInstance;
    const originalFetch = global.fetch;

    const setConfig = async ( code: string, value: unknown, isEncrypted = false ): Promise<void> => {
        const stored = isEncrypted ? encryptSystemConfigValue(value) : value;
        await sequelize.query(
            `UPDATE "systemConfig" SET "value" = CAST(:value AS jsonb) WHERE "code" = :code AND "scope" = 'WHODRUG'`,
            { replacements: { value: JSON.stringify(stored), code }, type: QueryTypes.UPDATE }
        );
    };

    const configureWhodrug = async (): Promise<void> => {
        await setConfig('ESAVI_WHODRUG_ENABLED', true);
        await setConfig('ESAVI_WHODRUG_CLIENT_KEY', 'test-client-key', true);
        await setConfig('ESAVI_WHODRUG_LICENSE_KEY', 'test-license-key', true);
        await setConfig('ESAVI_WHODRUG_DOWNLOAD_URL', downloadUrl);
    };

    const jsonResponse = ( status: number, payload: unknown ): Response => ( {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload
    } ) as unknown as Response;

    const mockDownload = ( payload: unknown, status = 200 ): jest.Mock => {
        const fetchMock = jest.fn(async () => jsonResponse(status, payload));
        global.fetch = fetchMock as unknown as typeof fetch;
        return fetchMock;
    };

    const sync = ( body: Record<string, unknown> = {} ) =>
        request(app).post('/api/whodrug-products/sync').set(authHeader('SUPERADMIN')).send(body);

    const admin = ( query: Record<string, unknown> = {} ) =>
        request(app).get('/api/whodrug-products/admin').set(authHeader('ADMIN')).query(query);

    const search = ( term: string, extra: Record<string, unknown> = {} ) =>
        request(app).get('/api/whodrug-products/search').set(authHeader('USER')).query({ term, ...extra });

    // A minimal drug of the UMC regional-drugs shape (references/external/01_transforme_v3.0.1.py)
    const apiDrug = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
        drugCode: `${ suffix }-A`,
        drugName: 'Paracetamol',
        isGeneric: true,
        isPreferred: false,
        atcs: [{ code: 'N02BE01' }],
        activeIngredients: [{ ingredient: 'Paracetamol', ingredientTranslations: [{ ingredient: 'Paracetamol' }] }],
        countryOfSales: [{ iso3Code: 'ECU', medicinalProductID: 'MP-ECU' }],
        ...overrides
    });

    const cleanupByPrefix = async (): Promise<void> => {
        await WhodrugProduct.destroy({ where: { drugCode: { [Op.like]: `${ suffix }%` } }, force: true });
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        global.fetch = originalFetch;

        await WhodrugProduct.destroy({ where: {}, force: true, truncate: false });

        // Back to the seeded state, so a suite that runs afterwards finds WHODrug off and unloaded
        await setConfig('ESAVI_WHODRUG_ENABLED', false);
        await setConfig('ESAVI_WHODRUG_CLIENT_KEY', '', true);
        await setConfig('ESAVI_WHODRUG_LICENSE_KEY', '', true);
        await setConfig('ESAVI_WHODRUG_DOWNLOAD_URL', 'https://api.who-umc.org/whodrug/download/v2/regional-drugs');
        await setConfig('ESAVI_WHODRUG_DOWNLOAD_PARAMS', { MedProdLevel: '3', IncludeAtc: 'true', IngredientTranslations: 'es-ES' });
        await setConfig('ESAVI_WHODRUG_SEARCH_COUNTRY', 'ECU');
        await setConfig('ESAVI_WHODRUG_SEARCH_EXCLUDED_ATC', ['J07']);

        await closeTestDatabase();
    });

    describe('input validation — ESAVI-WHODPROD-006', () => {

        it('rejects a term shorter than 3 characters with 400', async () => {
            const response = await search('ab');
            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        it('accepts a 3-character term', async () => {
            const response = await search('abc');
            expect(response.status).not.toBe(400);
        });

        it('rejects a limit above the configured ceiling with 400', async () => {
            const response = await search('abc', { limit: 500 });
            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-WHODPROD-007 — the switch and the configuration', () => {

        it('answers 503 WHODPROD_007_DISABLED without calling fetch when the switch is seeded off', async () => {
            const fetchMock = mockDownload([]);

            const response = await sync();

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('WHODPROD_007_DISABLED');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('answers 503 WHODPROD_007_NOT_CONFIGURED — never 500 — enabled with credentials still seeded empty', async () => {
            await setConfig('ESAVI_WHODRUG_ENABLED', true);
            const fetchMock = mockDownload([]);

            const response = await sync();

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('WHODPROD_007_NOT_CONFIGURED');
            expect(fetchMock).not.toHaveBeenCalled();
        });

    });

    describe('ESAVI-WHODPROD-007 — the download', () => {

        it('answers 502 WHODPROD_007_DOWNLOAD_FAILED when the API answers non-2xx', async () => {
            await configureWhodrug();
            mockDownload({}, 500);

            const response = await sync();

            expect(response.status).toBe(502);
            expect(response.body.code).toBe('WHODPROD_007_DOWNLOAD_FAILED');
        });

        it('answers 502 WHODPROD_007_DOWNLOAD_FAILED when the body is not an array', async () => {
            await configureWhodrug();
            mockDownload({ notAnArray: true });

            const response = await sync();

            expect(response.status).toBe(502);
            expect(response.body.code).toBe('WHODPROD_007_DOWNLOAD_FAILED');
        });

    });

    describe('ESAVI-WHODPROD-007 — dryRun', () => {

        it('returns a full report and writes nothing to the table', async () => {
            await configureWhodrug();
            mockDownload([ apiDrug() ]);

            const response = await sync({ dryRun: true });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ dryRun: true, downloaded: 1, flattened: 1, inserted: 1, unchanged: 0 });

            const count = await WhodrugProduct.count({ where: { drugCode: `${ suffix }-A` } });
            expect(count).toBe(0);
        });

    });

    describe('ESAVI-WHODPROD-007 — insertion, rejection and the differential contract', () => {

        afterEach(cleanupByPrefix);

        it('inserts what is valid, and the 002B lists it right after — a vaccine row included, uncut', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-A` }),
                apiDrug({ drugCode: `${ suffix }-VAX`, drugName: 'ComboVax', atcs: [{ code: 'J07AN01' }] })
            ]);

            const response = await sync();

            expect(response.status).toBe(200);
            expect(response.body.data.inserted).toBe(2);

            const listing = await admin({ name: 'ComboVax' });
            expect(listing.status).toBe(200);
            expect(listing.body.data.count).toBe(1);
            expect(listing.body.data.rows[0].drugCode).toBe(`${ suffix }-VAX`);
        });

        it('rejects an empty drugName as invalid and counts it, without aborting the rest of the download', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-A` }),
                apiDrug({ drugCode: `${ suffix }-BAD`, drugName: '' })
            ]);

            const response = await sync();

            expect(response.body.data.inserted).toBe(1);
            expect(response.body.data.invalid).toBe(1);
            expect(response.body.data.errors).toEqual(
                expect.arrayContaining([ expect.objectContaining({ reason: 'EMPTY_DRUG_NAME' }) ])
            );
        });

        it('rejects a value exceeding its column width as VALUE_TOO_LONG, naming the column', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-${ 'X'.repeat(60) }` })
            ]);

            const response = await sync();

            expect(response.body.data.invalid).toBe(1);
            expect(response.body.data.errors[0]).toMatchObject({ reason: 'VALUE_TOO_LONG', column: 'drugCode' });
        });

        it('counts a second identical row within the same download as duplicated, keeping the first', async () => {
            await configureWhodrug();
            // Two API entries that flatten to the exact same rowHash: same drugCode, same single
            // ATC, no country/holder/form/strength to vary the key
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-DUP`, activeIngredients: [], countryOfSales: [] }),
                apiDrug({ drugCode: `${ suffix }-DUP`, activeIngredients: [], countryOfSales: [] })
            ]);

            const response = await sync();

            expect(response.body.data.inserted).toBe(1);
            expect(response.body.data.duplicated).toBe(1);

            const count = await WhodrugProduct.count({ where: { drugCode: `${ suffix }-DUP` } });
            expect(count).toBe(1);
        });

        it('a repeated sync over the identical download reports inserted:0, updated:0, unchanged:N and moves nothing', async () => {
            await configureWhodrug();
            const fixture = [ apiDrug({ drugCode: `${ suffix }-A` }) ];
            mockDownload(fixture);

            const first = await sync();
            expect(first.body.data.inserted).toBe(1);

            const rowAfterInsert = await WhodrugProduct.findOne({ where: { drugCode: `${ suffix }-A` } });
            const appDetailsLengthAfterInsert = (rowAfterInsert!.appDetails ?? []).length;
            const updatedAtAfterInsert = rowAfterInsert!.updatedAt;

            mockDownload(fixture);
            const second = await sync();

            expect(second.body.data).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, deactivated: 0 });

            const rowAfterSecond = await WhodrugProduct.findOne({ where: { drugCode: `${ suffix }-A` } });
            expect(rowAfterSecond!.updatedAt).toEqual(updatedAtAfterInsert);
            expect((rowAfterSecond!.appDetails ?? []).length).toBe(appDetailsLengthAfterInsert);
        });

        it('a download in which one field of one row changed reports updated:1, unchanged:N-1 and adds exactly one appDetails entry', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-A` }),
                apiDrug({ drugCode: `${ suffix }-B` })
            ]);
            await sync();

            mockDownload([
                apiDrug({ drugCode: `${ suffix }-A`, drugName: 'Paracetamol Renamed' }),
                apiDrug({ drugCode: `${ suffix }-B` })
            ]);
            const response = await sync();

            expect(response.body.data).toMatchObject({ updated: 1, unchanged: 1, inserted: 0 });

            const changedRow = await WhodrugProduct.findOne({ where: { drugCode: `${ suffix }-A` } });
            expect(changedRow!.drugName).toBe('Paracetamol Renamed');
            expect((changedRow!.appDetails ?? [])).toHaveLength(2);
        });

        it('two rows with the same rowHash across the SAME download never raise a unique constraint error', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-UQ`, activeIngredients: [], countryOfSales: [] }),
                apiDrug({ drugCode: `${ suffix }-UQ`, activeIngredients: [], countryOfSales: [] })
            ]);

            const response = await sync();

            expect(response.status).toBe(200);
        });

    });

    describe('ESAVI-WHODPROD-007 — deactivation and reactivation are not differential', () => {

        afterEach(cleanupByPrefix);

        it('deactivates a row missing from a later download, and reactivates it when it comes back — neither is invisible from the 002B', async () => {
            await configureWhodrug();
            const both = [
                apiDrug({ drugCode: `${ suffix }-KEEP`, drugName: `KeepZzq${ suffix }` }),
                apiDrug({ drugCode: `${ suffix }-GONE`, drugName: `GoneZzq${ suffix }` })
            ];
            const onlyKeep = [ apiDrug({ drugCode: `${ suffix }-KEEP`, drugName: `KeepZzq${ suffix }` }) ];

            mockDownload(both);
            await sync();

            mockDownload(onlyKeep);
            const secondResponse = await sync();
            expect(secondResponse.body.data).toMatchObject({ deactivated: 1, unchanged: 1 });

            const deactivatedRow = await WhodrugProduct.findOne({ where: { drugCode: `${ suffix }-GONE` } });
            expect(deactivatedRow?.isActive).toBe(false);
            expect(deactivatedRow?.deletedAt).not.toBeNull();

            // 002B still shows it — inactive rows are the inspection listing's whole point
            const listing = await admin({ name: deactivatedRow!.drugName });
            expect(listing.body.data.count).toBe(1);

            mockDownload(both);
            const thirdResponse = await sync();
            expect(thirdResponse.body.data).toMatchObject({ updated: 1, deactivated: 0 });

            const reactivatedRow = await WhodrugProduct.findOne({ where: { drugCode: `${ suffix }-GONE` } });
            expect(reactivatedRow?.isActive).toBe(true);
            expect(reactivatedRow?.deletedAt).toBeNull();
        });

        it('a deactivated row does not appear in the 006 search', async () => {
            await configureWhodrug();
            mockDownload([ apiDrug({ drugCode: `${ suffix }-VANISH`, drugName: 'VanishTermZzq' }) ]);
            await sync();

            mockDownload([]);
            await sync();

            const result = await search('vanishtermzzq');
            expect(result.body.data.count).toBe(0);
        });

    });

    describe('ESAVI-WHODPROD-007 — single concurrent execution', () => {

        // Exercised at the service layer and not over HTTP: two genuinely concurrent requests
        // against the same in-process Express app cannot both be in flight through supertest in
        // this environment — the second one never reaches the server while the first's handler is
        // still pending, a supertest/Node limitation confirmed with a minimal Express app carrying
        // none of this spec's code. The in-memory guard itself is what is under test here, and it
        // lives in the service regardless of the transport that calls it
        it('answers 409 WHODPROD_007_ALREADY_RUNNING for a second sync fired while the first is in flight', async () => {
            await configureWhodrug();
            const superadmin = getTestUser('SUPERADMIN');

            let resolveFirst: (value: unknown) => void = () => {};
            global.fetch = jest.fn().mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; })) as unknown as typeof fetch;

            const authUser = { userId: superadmin.userId } as AuthUser;
            const firstRun = syncWhodrugProductsService({}, authUser, 'es');
            await new Promise((r) => setTimeout(r, 20));

            await expect(syncWhodrugProductsService({}, authUser, 'es'))
                .rejects.toMatchObject({ statusCode: 409, code: 'WHODPROD_007_ALREADY_RUNNING' });

            resolveFirst(jsonResponse(200, []));
            await firstRun;
        });

    });

    describe('ESAVI-WHODPROD-006 — concomitant medication search', () => {

        afterEach(cleanupByPrefix);

        it('excludes a vaccine (J07) from every result, and collapses N presentations of a medicine into one row', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-VAX2`, drugName: `VaxSearchZzq${ suffix }`, atcs: [{ code: 'J07AN01' }] }),
                apiDrug({
                    drugCode: `${ suffix }-MULTI`,
                    drugName: `MultiPresZzq${ suffix }`,
                    isPreferred: false,
                    countryOfSales: [
                        { iso3Code: 'ECU', medicinalProductID: 'A', maHolders: [{ name: 'H1', medicinalProductID: 'H1', forms: [{ form: 'Tablet', medicinalProductID: 'F1', strengths: [{ strength: '250mg', medicinalProductID: 'S1' }] }] }] }
                    ]
                })
            ]);
            await sync();

            const vaccineSearch = await search('vaxsearchzzq' + suffix.toLowerCase());
            expect(vaccineSearch.body.data.count).toBe(0);

            const medicineSearch = await search('multipreszzq' + suffix.toLowerCase());
            expect(medicineSearch.body.data.count).toBe(1);
        });

        it('a product with a mix of vaccine and non-vaccine ATCs is excluded by any of its rows', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({
                    drugCode: `${ suffix }-MIX`,
                    drugName: `MixAtcZzq${ suffix }`,
                    atcs: [{ code: 'J07AN01' }, { code: 'L03AX' }]
                })
            ]);
            await sync();

            const result = await search('mixatczzq' + suffix.toLowerCase());
            expect(result.body.data.count).toBe(0);
        });

        it('a generic with no declared country appears; a branded product with no country does not', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-GEN`, drugName: `GenNoCountryZzq${ suffix }`, isGeneric: true, countryOfSales: [] }),
                apiDrug({ drugCode: `${ suffix }-BRD`, drugName: `BrandNoCountryZzq${ suffix }`, isGeneric: false, countryOfSales: [] })
            ]);
            await sync();

            const generic = await search('gennocountryzzq' + suffix.toLowerCase());
            expect(generic.body.data.count).toBe(1);

            const brand = await search('brandnocountryzzq' + suffix.toLowerCase());
            expect(brand.body.data.count).toBe(0);
        });

        it('respects the limit ceiling', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({ drugCode: `${ suffix }-L1`, drugName: `LimitZzq${ suffix } One` }),
                apiDrug({ drugCode: `${ suffix }-L2`, drugName: `LimitZzq${ suffix } Two` })
            ]);
            await sync();

            const result = await search('limitzzq' + suffix.toLowerCase(), { limit: 1 });
            expect(result.body.data.rows.length).toBeLessThanOrEqual(1);
        });

    });

    describe('ESAVI-WHODPROD-002B — inspection listing', () => {

        it('returns { count: 0, rows: [] } when nothing matches', async () => {
            const response = await admin({ name: `NothingMatchesZzq${ suffix }` });
            expect(response.status).toBe(200);
            expect(response.body.data).toEqual({ count: 0, rows: [] });
        });

        it('filters by ingredient across both ingredient and ingredientTranslations', async () => {
            await configureWhodrug();
            mockDownload([
                apiDrug({
                    drugCode: `${ suffix }-ING`,
                    drugName: `IngredientZzq${ suffix }`,
                    activeIngredients: [{ ingredient: 'Acetaminophen', ingredientTranslations: [{ ingredient: 'Paracetamolo' }] }]
                })
            ]);
            await sync();

            const byEnglish = await admin({ ingredient: 'Acetaminophen' });
            expect(byEnglish.body.data.count).toBe(1);

            const byTranslation = await admin({ ingredient: 'Paracetamolo' });
            expect(byTranslation.body.data.count).toBe(1);

            await cleanupByPrefix();
        });

        it('never applies the ATC exclusion or the country policy — a vaccine matched by name comes back', async () => {
            await configureWhodrug();
            mockDownload([ apiDrug({ drugCode: `${ suffix }-VAXADM`, drugName: `VaxAdminZzq${ suffix }`, atcs: [{ code: 'J07AN01' }] }) ]);
            await sync();

            const response = await admin({ name: `VaxAdminZzq${ suffix }` });
            expect(response.body.data.count).toBe(1);

            await cleanupByPrefix();
        });

    });

});
