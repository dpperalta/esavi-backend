import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { encryptSystemConfigValue } from '../../src/helpers/systemConfigValue.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';

/**
 * Contract suite for ESAVI-MEDDRA-006 of SPEC F55.
 *
 * NO TEST GOES OUT TO THE NETWORK. `global.fetch` is the seam — the plugin's mock mode is not
 * ported, by the decision of §6: a switch that makes the backend invent clinical data is a risk
 * that does not pay for itself, and the honest place for the seam is where the process leaves.
 *
 * The configuration travels through the real chain: the rows of scope MEDDRA that `globalSetup`
 * already seeded through ESAVI-SYSCONF-008 are rewritten here with raw SQL, exactly as
 * `tests/setup/database.ts` does for MAIL. That is what makes the precedence of SPEC F43 —
 * the database wins, `.env` is the fallback — the thing under test rather than a mock of it.
 */
describe('meddra contract', () => {

    const tokenUrl = 'https://meddra.test/connect/token';
    const searchUrl = 'https://meddra.test/api/search';

    // The seeded body of §3.8, with the level flags the derivation of `termGroup` reads
    const searchConfigBody = {
        addlangs: [],
        bview: 'SOC',
        contains: true,
        filters: [],
        hlgt: false,
        hlt: false,
        idiacritical: true,
        kana: false,
        language: 'Spanish',
        llt: true,
        pt: false,
        rsview: 'release',
        searchterms: [ { searchlogic: 0, searchterm: '', searchtype: 0 } ],
        separator: 2,
        skip: 0,
        smq: false,
        soc: false,
        stype: 1,
        synonym: true,
        take: 20,
        version: 28
    };

    // errorHandler logs every error it handles, and half of these tests trigger errors on purpose
    let consoleError: jest.SpyInstance;
    const originalFetch = global.fetch;

    // Rewrites one row of scope MEDDRA, the same way tests/setup/database.ts loads the MAIL ones.
    // The two credentials carry isEncrypted, so their value has to travel wrapped
    const setConfig = async ( code: string, value: unknown, isEncrypted = false ): Promise<void> => {
        const stored = isEncrypted ? encryptSystemConfigValue(value) : value;

        await sequelize.query(
            `UPDATE "systemConfig" SET "value" = CAST(:value AS jsonb)
             WHERE "code" = :code AND "scope" = 'MEDDRA'`,
            {
                replacements: { value: JSON.stringify(stored), code },
                type: QueryTypes.UPDATE
            }
        );
    };

    const configureMeddra = async (): Promise<void> => {
        await setConfig('ESAVI_MEDDRA_ENABLED', true);
        await setConfig('ESAVI_MEDDRA_USERNAME', 'meddra-test-user', true);
        await setConfig('ESAVI_MEDDRA_PASSWORD', 'meddra-test-password', true);
        await setConfig('ESAVI_MEDDRA_TOKEN_URL', tokenUrl);
        await setConfig('ESAVI_MEDDRA_SEARCH_URL', searchUrl);
        await setConfig('ESAVI_MEDDRA_SEARCH_CONFIG', searchConfigBody);
    };

    // What the service reads off a Response: `ok`, `status` and `json()`
    const jsonResponse = ( status: number, payload: unknown ): Response => ( {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload
    } ) as unknown as Response;

    // Answers the token endpoint and the search endpoint by URL, so a test can assert how many
    // times each one was reached
    const mockFetch = ( searchPayload: unknown, tokenStatus = 200 ): jest.Mock => {
        const fetchMock = jest.fn(async ( url: string ) => {
            if( String(url) === tokenUrl ) {
                return tokenStatus === 200
                    ? jsonResponse(200, { access_token: 'test-token', expires_in: 3600 })
                    : jsonResponse(tokenStatus, {});
            }
            return jsonResponse(200, searchPayload);
        });

        global.fetch = fetchMock as unknown as typeof fetch;

        return fetchMock;
    };

    const callsTo = ( fetchMock: jest.Mock, url: string ): unknown[][] =>
        fetchMock.mock.calls.filter(call => String(call[0]) === url);

    const search = ( term: string, lang?: string ) =>
        request(app)
            .get('/api/meddra/search')
            .query(lang ? { term, lang } : { term })
            .set(authHeader('USER'));

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        global.fetch = originalFetch;

        // Back to the seeded state, so a suite that runs afterwards finds MedDRA off and unloaded
        await setConfig('ESAVI_MEDDRA_ENABLED', false);
        await setConfig('ESAVI_MEDDRA_USERNAME', '', true);
        await setConfig('ESAVI_MEDDRA_PASSWORD', '', true);
        await setConfig('ESAVI_MEDDRA_TOKEN_URL', 'https://mid.meddra.org/connect/token');
        await setConfig('ESAVI_MEDDRA_SEARCH_URL', 'https://mapisbx.meddra.org/api/search');
        await setConfig('ESAVI_MEDDRA_SEARCH_CONFIG', searchConfigBody);

        await closeTestDatabase();
    });

    describe('input validation — ESAVI-MEDDRA-006', () => {

        it('rejects a term shorter than 3 characters with 400', async () => {
            const response = await search('fi');

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        it('rejects a missing term with 400', async () => {
            const response = await request(app)
                .get('/api/meddra/search')
                .set(authHeader('USER'));

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

    });

    describe('the switch and the configuration', () => {

        it('answers 503 MEDDRA_006_DISABLED without calling fetch when the switch is off', async () => {
            // The seeded state: ESAVI-SYSCONF-008 leaves the switch in false on purpose
            const fetchMock = mockFetch([]);

            const response = await search('fiebre');

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('MEDDRA_006_DISABLED');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('answers 503 MEDDRA_006_NOT_CONFIGURED — never 500 — with the switch on and no credential', async () => {
            await setConfig('ESAVI_MEDDRA_ENABLED', true);
            const fetchMock = mockFetch([]);

            const response = await search('fiebre');

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('MEDDRA_006_NOT_CONFIGURED');
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('answers 503 MEDDRA_006_INVALID_SEARCH_CONFIG when no level flag is true', async () => {
            await configureMeddra();
            await setConfig('ESAVI_MEDDRA_SEARCH_CONFIG', { ...searchConfigBody, llt: false });
            const fetchMock = mockFetch([]);

            const response = await search('fiebre');

            expect(response.status).toBe(503);
            expect(response.body.code).toBe('MEDDRA_006_INVALID_SEARCH_CONFIG');
            expect(fetchMock).not.toHaveBeenCalled();

            await setConfig('ESAVI_MEDDRA_SEARCH_CONFIG', searchConfigBody);
        });

    });

    describe('the two outbound calls', () => {

        it('answers 502 MEDDRA_006_AUTH_FAILED and keeps no token when the token endpoint says 401', async () => {
            await configureMeddra();
            const failing = mockFetch([], 401);

            const response = await search('auth uno');

            expect(response.status).toBe(502);
            expect(response.body.code).toBe('MEDDRA_006_AUTH_FAILED');
            expect(callsTo(failing, tokenUrl)).toHaveLength(1);
            expect(callsTo(failing, searchUrl)).toHaveLength(0);

            // Nothing usable was retained: the next search asks the token endpoint again
            const working = mockFetch([]);
            const second = await search('auth dos');

            expect(second.status).toBe(200);
            expect(callsTo(working, tokenUrl)).toHaveLength(1);
        });

        it('answers 504 MEDDRA_006_TIMEOUT when the API never answers', async () => {
            await configureMeddra();

            // The mock honours the signal, which is what real fetch does on abort; without that
            // the AbortController of the service would have nothing to act on
            const hanging = jest.fn(( _url: string, init: RequestInit ) => new Promise<Response>(( _resolve, reject ) => {
                init.signal?.addEventListener('abort', () => {
                    const abortError = new Error('The operation was aborted');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            }));
            global.fetch = hanging as unknown as typeof fetch;

            const response = await search('timeout uno');

            expect(response.status).toBe(504);
            expect(response.body.code).toBe('MEDDRA_006_TIMEOUT');
        }, 20000);

        it('answers 502 MEDDRA_006_SEARCH_FAILED when the search endpoint answers 500', async () => {
            await configureMeddra();
            const fetchMock = jest.fn(async ( url: string ) => String(url) === tokenUrl
                ? jsonResponse(200, { access_token: 'test-token', expires_in: 3600 })
                : jsonResponse(500, {}));
            global.fetch = fetchMock as unknown as typeof fetch;

            const response = await search('search rota');

            expect(response.status).toBe(502);
            expect(response.body.code).toBe('MEDDRA_006_SEARCH_FAILED');
        });

    });

    describe('the answer', () => {

        it('translates pcode to code, stamps the derived termGroup and drops what is malformed', async () => {
            await configureMeddra();
            mockFetch([
                { pcode: '10016558', name: 'Fiebre', extra: 'ignored' },
                { pcode: '10027669', name: 'Fiebre Amarilla' },
                // Same pcode as the first one: the first appearance wins
                { pcode: '10016558', name: 'Fiebre duplicada' },
                // No pcode: dropped in silence, and it must not bring the answer down
                { name: 'Sin código' }
            ]);

            const response = await search('normaliza uno');

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(typeof response.body.message).toBe('string');
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.count).toBe(response.body.data.rows.length);
            expect(response.body.data.rows).toEqual([
                { code: '10016558', name: 'Fiebre', termGroup: 'LLT' },
                { code: '10027669', name: 'Fiebre Amarilla', termGroup: 'LLT' }
            ]);
            // Exactly three keys per row: no pcode and no id leak through
            for( const row of response.body.data.rows ) {
                expect(Object.keys(row).sort()).toEqual(['code', 'name', 'termGroup']);
            }
        });

        it('answers 200 with an empty result — never 404 — when the term matches nothing', async () => {
            await configureMeddra();
            mockFetch({ results: [] });

            const response = await search('vacio uno');

            expect(response.status).toBe(200);
            expect(response.body.data).toEqual({ count: 0, rows: [] });
        });

        it('unwraps the list from `results` and from `data`', async () => {
            await configureMeddra();
            mockFetch({ results: [ { pcode: '1', name: 'Uno' } ] });
            const fromResults = await search('envoltura uno');

            mockFetch({ data: [ { pcode: '2', name: 'Dos' } ] });
            const fromData = await search('envoltura dos');

            expect(fromResults.body.data.rows).toEqual([ { code: '1', name: 'Uno', termGroup: 'LLT' } ]);
            expect(fromData.body.data.rows).toEqual([ { code: '2', name: 'Dos', termGroup: 'LLT' } ]);
        });

    });

    describe('the body sent to the API', () => {

        it('sends the whole configured body and rewrites only searchterm and language', async () => {
            await configureMeddra();
            const fetchMock = mockFetch([]);

            await search('cuerpo uno');

            const [ searchCall ] = callsTo(fetchMock, searchUrl);
            const init = searchCall[1] as RequestInit;
            const sent = JSON.parse(init.body as string);

            expect(Object.keys(sent).sort()).toEqual(Object.keys(searchConfigBody).sort());
            expect(sent.searchterms[0]).toEqual({ searchlogic: 0, searchterm: 'cuerpo uno', searchtype: 0 });

            // Everything but the two rewritten keys travels exactly as configured
            for( const key of Object.keys(searchConfigBody) ) {
                if( key === 'searchterms' || key === 'language' ) {
                    continue;
                }
                expect(sent[key]).toEqual(searchConfigBody[key as keyof typeof searchConfigBody]);
            }

            expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
        });

    });

    describe('the result cache', () => {

        it('serves the second identical search without calling the API again', async () => {
            await configureMeddra();
            const fetchMock = mockFetch([ { pcode: '10016558', name: 'Fiebre' } ]);

            const first = await search('cache uno');
            const second = await search('cache uno');

            expect(first.body.data).toEqual(second.body.data);
            expect(callsTo(fetchMock, searchUrl)).toHaveLength(1);
        });

        it('keys the cache by language: the same term in es and en is two calls', async () => {
            await configureMeddra();
            const fetchMock = mockFetch([ { pcode: '10016558', name: 'Fiebre' } ]);

            await search('idioma uno', 'es');
            await search('idioma uno', 'en');

            const searchCalls = callsTo(fetchMock, searchUrl);

            expect(searchCalls).toHaveLength(2);

            const languages = searchCalls.map(call => JSON.parse((call[1] as RequestInit).body as string).language);

            expect(languages).toEqual(['Spanish', 'English']);
        });

    });

});
