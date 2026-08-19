import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';

/**
 * Verifies the response contract itself, not the behaviour of any single
 * entity. `catalogType` is the vehicle because it exposes the full set of seven
 * operations, but every assertion here is about the envelope.
 */
describe('response contract', () => {

    const suffix = Date.now().toString(36);
    let createdId: string;

    beforeAll(async () => {
        await seedTestUsers();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('success envelope', () => {

        // ESAVI-CATTYPE-001
        it('create responds 201 with ok, message and data', async () => {
            const response = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send({ code: `contractType${ suffix }`, name: `Contract type ${ suffix }` });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(typeof response.body.message).toBe('string');
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeDefined();

            createdId = response.body.data.catalogTypeId;
            expect(createdId).toEqual(expect.any(String));
        });

        // ESAVI-CATTYPE-002
        it('list responds 200 with ok, message and data', async () => {
            const response = await request(app)
                .get('/api/catalog-types')
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeDefined();
        });

        // ESAVI-CATTYPE-003
        it('getById responds 200 with ok, message and data', async () => {
            const response = await request(app)
                .get(`/api/catalog-types/${ createdId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeDefined();
        });

        // ESAVI-CATTYPE-004
        it('update responds 200 with ok, message and data', async () => {
            const response = await request(app)
                .put(`/api/catalog-types/${ createdId }`)
                .set(authHeader('ADMIN'))
                .send({ name: `Contract type ${ suffix } renamed` });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeDefined();
        });

        // ESAVI-CATTYPE-005A — delete carries no data by contract
        it('delete responds 200 with ok and message, and no data', async () => {
            const response = await request(app)
                .delete(`/api/catalog-types/${ createdId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeUndefined();
        });

        // ESAVI-CATTYPE-005B — activate carries no data by contract
        it('activate responds 200 with ok and message, and no data', async () => {
            const response = await request(app)
                .patch(`/api/catalog-types/activate/${ createdId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeUndefined();
        });

        it('never uses 201 outside create', async () => {
            const responses = await Promise.all([
                request(app).get('/api/catalog-types').set(authHeader('USER')),
                request(app).get(`/api/catalog-types/${ createdId }`).set(authHeader('USER'))
            ]);

            responses.forEach(response => expect(response.status).toBe(200));
        });

    });

    /**
     * CONVENTIONS.md §10 — `005A`, `005B` and `005C` answer `{ ok, message }`
     * with no `data`. The two tests above prove it for `catalogType` only, which
     * is how `notificationVaccine` came to return the row in delete and activate
     * without a single suite turning red. This guard reads the source of every
     * controller instead, so a new entity cannot opt out of the rule by being
     * new.
     */
    describe('state operations carry no data — static guard over every controller', () => {

        const controllersDir = path.join(__dirname, '..', '..', 'src', 'controllers');

        // Body of each `res.status(...).json({ ... })` in the file, non-greedy so
        // one match is one response object
        const responseBlock = /res\.status\(\s*\d+\s*\)\.json\(\{([\s\S]*?)\}\)/g;
        const stateMessage = /\.(deletedSuccess|activatedSuccess|purgeSuccess)'/;

        const stateBlocks = fs.readdirSync(controllersDir)
            .filter(file => file.endsWith('.controller.ts'))
            .flatMap(file => {
                const source = fs.readFileSync(path.join(controllersDir, file), 'utf8');
                return [...source.matchAll(responseBlock)]
                    .map(match => match[1])
                    .filter(body => stateMessage.test(body))
                    .map(body => ({ file, body }));
            });

        it('finds the state responses it is meant to police', () => {
            // A refactor that changes the shape of the response would leave this
            // guard matching nothing and passing in silence
            expect(stateBlocks.length).toBeGreaterThanOrEqual(40);
        });

        it.each(stateBlocks.map(({ file, body }) => [file, body.match(stateMessage)?.[1], body]))(
            '%s — %s responds without data',
            (_file, _key, body) => {
                expect(body).not.toMatch(/\bdata\b/);
            }
        );

    });

    describe('error envelope, as built by errorHandler', () => {

        // errorHandler logs every error it handles; these tests trigger errors on
        // purpose, so the log is expected output rather than a signal.
        let consoleError: jest.SpyInstance;

        beforeAll(() => {
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterAll(() => {
            consoleError.mockRestore();
        });

        const expectErrorEnvelope = ( body: Record<string, unknown> ): void => {
            expect(body.ok).toBe(false);
            expect(typeof body.message).toBe('string');
            expect((body.message as string).length).toBeGreaterThan(0);
            expect(typeof body.code).toBe('string');
            expect((body.code as string).length).toBeGreaterThan(0);
            // NODE_ENV is `test`, so the real error text must never reach the client
            expect(body.errors).toBe('Internal server error');
        };

        it('404 on a nonexistent id', async () => {
            const response = await request(app)
                .get('/api/catalog-types/00000000-0000-4000-8000-000000000000')
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expectErrorEnvelope(response.body);
        });

        it('409 on a duplicate code in create', async () => {
            const payload = { code: `dupType${ suffix }`, name: `Dup type ${ suffix }` };

            const first = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send(payload);
            expect(first.status).toBe(201);

            const second = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send(payload);

            expect(second.status).toBe(409);
            expectErrorEnvelope(second.body);
        });

        it('409 on a duplicate code in update', async () => {
            const target = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send({ code: `dupUpdate${ suffix }`, name: `Dup update ${ suffix }` });
            expect(target.status).toBe(201);

            const response = await request(app)
                .put(`/api/catalog-types/${ target.body.data.catalogTypeId }`)
                .set(authHeader('ADMIN'))
                .send({ code: `dupType${ suffix }` });

            expect(response.status).toBe(409);
            expectErrorEnvelope(response.body);
        });

        it('400 on a payload the validator rejects', async () => {
            const response = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('ADMIN'))
                .send({ name: 'Missing its code' });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            expect(response.body.message.length).toBeGreaterThan(0);
        });

        it('400 on a malformed uuid', async () => {
            const response = await request(app)
                .get('/api/catalog-types/not-a-uuid')
                .set(authHeader('USER'));

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

    });

    /**
     * DEUDA-032: `tokenValidation` and `roleValidation` build their error
     * responses by hand instead of throwing `AppError`, so 401 and 403 carry
     * `error` rather than `code` + `errors`. These tests pin the current
     * behaviour on purpose — when the debt is settled they will fail, which is
     * the signal to fold 401 and 403 into `expectErrorEnvelope` above.
     */
    describe('known deviation — 401 and 403 bypass errorHandler (DEUDA-032)', () => {

        it('401 without a token: ok and message, but no code', async () => {
            const response = await request(app).get('/api/catalog-types');

            expect(response.status).toBe(401);
            expect(response.body.ok).toBe(false);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.code).toBeUndefined();
        });

        it('403 with an insufficient role: ok and message, but no code', async () => {
            const response = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('USER'))
                .send({ code: `forbidden${ suffix }`, name: `Forbidden ${ suffix }` });

            expect(response.status).toBe(403);
            expect(response.body.ok).toBe(false);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.code).toBeUndefined();
        });

    });

});
