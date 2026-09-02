import request from 'supertest';
import { app } from '../../src/app';
import { GeoLevelType } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * geoLevelType has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-GEOTYPE-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 */
describe('geoLevelType contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    beforeAll(async () => {
        await seedTestUsers();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await request(app)
                .post('/api/geo-level-types')
                .set(authHeader('ADMIN'))
                .send({
                    code: `DIFF${ suffix }`,
                    name: `Differential ${ suffix }`,
                    sortOrder: 1
                });

            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/geo-level-types',
                id: created.body.data.geoLevelTypeId,
                model: GeoLevelType,
                role: 'SUPERADMIN'
            });
        });

    });

    /**
     * ESAVI-GEOTYPE-002A/002B — SPEC F52. The entity had no text filter at all before this spec:
     * name and code are the canonical parameters, joined with Op.or, with no legacy search alias.
     * code is stored as sent, only trimmed and uppercased — no separator is stripped — so a literal
     * underscore in the query is a meaningful escape case here, unlike catalogType
     */
    describe('name/code search — SPEC F52', () => {

        const tag = `SEARCH${ suffix }`;
        let sortOrder = 100;
        let findableId: string;
        let inactiveId: string;

        const createType = ( payload: Record<string, unknown> ) =>
            request(app).post('/api/geo-level-types').set(authHeader('ADMIN'))
                .send({ sortOrder: ++sortOrder, ...payload });

        beforeAll(async () => {
            const findable = await createType({ code: `LOOKUP_${ tag }`, name: `Findable Level ${ tag }` });
            expect(findable.status).toBe(201);
            findableId = findable.body.data.geoLevelTypeId;

            const inactive = await createType({ code: `RETIRED_${ tag }`, name: `Retired Level ${ tag }` });
            expect(inactive.status).toBe(201);
            inactiveId = inactive.body.data.geoLevelTypeId;
            const deleted = await request(app).delete(`/api/geo-level-types/${ inactiveId }`).set(authHeader('ADMIN'));
            expect(deleted.status).toBe(200);

            await createType({ code: `WILD_A_${ tag }`, name: `Wildcard probe ${ tag }` });
            await createType({ code: `WILDXA_${ tag }`, name: `Wildcard probe twin ${ tag }` });
        });

        const list = ( qs: string, role: 'USER' | 'SUPERADMIN' = 'USER' ) =>
            request(app).get(`/api/geo-level-types?${ qs }&limit=100`).set(authHeader(role));

        it('name matches partially and case insensitively', async () => {
            const response = await list(`name=findable level ${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { geoLevelTypeId: string }) => r.geoLevelTypeId)).toContain(findableId);
        });

        it('code matches partially and case insensitively', async () => {
            const response = await list(`code=lookup_${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { geoLevelTypeId: string }) => r.geoLevelTypeId)).toEqual([findableId]);
        });

        it('name and code combine with Op.or — a match on either is enough', async () => {
            const response = await list(`name=noExisteEsteNombre${ tag }&code=lookup_${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { geoLevelTypeId: string }) => r.geoLevelTypeId)).toContain(findableId);
        });

        it('a USER never sees the inactive row', async () => {
            const response = await list(`name=Retired Level ${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows).toHaveLength(0);
        });

        it('a SUPERADMIN filtered read includes the inactive row', async () => {
            const response = await list(`name=Retired Level ${ tag }`, 'SUPERADMIN');
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { geoLevelTypeId: string }) => r.geoLevelTypeId)).toContain(inactiveId);
        });

        it('?name=a (one character) responds 400; ?name=ab responds 200', async () => {
            expect((await list('name=a')).status).toBe(400);
            expect((await list('name=ab')).status).toBe(200);
        });

        it('a literal underscore in code does not act as a single-character wildcard', async () => {
            const response = await list(`code=WILD_A_${ tag }`);
            expect(response.status).toBe(200);
            const codes = response.body.data.rows.map((r: { code: string }) => r.code);
            expect(codes).toContain(`WILD_A_${ tag }`);
            expect(codes).not.toContain(`WILDXA_${ tag }`);
        });

        it('no parameter still returns the unfiltered catalog, exactly as before this spec', async () => {
            const response = await list('');
            expect(response.status).toBe(200);
            expect(response.body.data.rows.length).toBeGreaterThan(0);
        });

    });

    /**
     * SPEC F52 §1.E / §3.8 — attributes: { exclude: ['sysDetails'] } on the 002A, 002B and 003 of
     * this entity. sysDetails is internal by convention and the rest of the repository already
     * excludes it; appDetails keeps travelling
     */
    describe('sysDetails alignment — SPEC F52', () => {

        let id: string;

        beforeAll(async () => {
            const created = await request(app)
                .post('/api/geo-level-types')
                .set(authHeader('ADMIN'))
                .send({ code: `SYSDET${ suffix }`, name: `SysDetails ${ suffix }`, sortOrder: 999 });
            expect(created.status).toBe(201);
            id = created.body.data.geoLevelTypeId;
        });

        it('is absent from 002A (USER, active only)', async () => {
            const response = await request(app).get('/api/geo-level-types?limit=100').set(authHeader('USER'));
            expect(response.status).toBe(200);
            const row = response.body.data.rows.find((r: { geoLevelTypeId: string }) => r.geoLevelTypeId === id);
            expect(row).not.toHaveProperty('sysDetails');
            expect(row).toHaveProperty('appDetails');
        });

        it('is absent from 002B (SUPERADMIN, including inactive)', async () => {
            const response = await request(app).get('/api/geo-level-types?limit=100').set(authHeader('SUPERADMIN'));
            expect(response.status).toBe(200);
            const row = response.body.data.rows.find((r: { geoLevelTypeId: string }) => r.geoLevelTypeId === id);
            expect(row).not.toHaveProperty('sysDetails');
            expect(row).toHaveProperty('appDetails');
        });

        it('is absent from 003 (get by id)', async () => {
            const response = await request(app).get(`/api/geo-level-types/${ id }`).set(authHeader('USER'));
            expect(response.status).toBe(200);
            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data).toHaveProperty('appDetails');
        });

    });

});
