import request from 'supertest';
import { app } from '../../src/app';
import { CatalogType } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * catalogType has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-CATTYPE-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 */
describe('catalogType contract', () => {

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
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({
                    code: `differential${ suffix }`,
                    name: `Differential ${ suffix }`,
                    description: 'Catalog type of the differential update case',
                    sortOrder: 1
                });

            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/catalog-types',
                id: created.body.data.catalogTypeId,
                model: CatalogType,
                role: 'SUPERADMIN'
            });
        });

    });

    /**
     * The code travels in the body when the client sends one, normalized into camelCase, and is
     * minted from the name only when it does not. On an update it is written exactly when it
     * travels and never re-minted from a name that changed.
     */
    describe('code sent in the body or minted from the name', () => {

        // Digits only: toTitleCase lowercases everything after the first letter of each word, so a
        // suffix carrying letters would come back mangled and the expectations would read as noise
        const tag = Date.now().toString().slice(-6);

        // errorHandler logs every error it handles and one of these cases triggers one on purpose
        let consoleError: jest.SpyInstance;

        beforeAll(() => {
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterAll(() => {
            consoleError.mockRestore();
        });

        it('mints the code from the name when the body brings none', async () => {
            const created = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Tipo evento ${ tag }` });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(`tipoEvento${ tag }`);
            expect(created.body.data.name).toBe(`Tipo Evento ${ tag }`);
        });

        it('takes the code from the body, normalized, and leaves an already camelCase one untouched', async () => {
            const created = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ code: `TIPO_A_MANO_${ tag }`, name: `Nombre Distinto ${ tag }` });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(`tipoAMano${ tag }`);

            // The normalization is idempotent: resending the stored code writes the same value
            const echoed = await request(app)
                .put(`/api/catalog-types/${ created.body.data.catalogTypeId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ code: created.body.data.code });

            expect(echoed.status).toBe(200);
            expect(echoed.body.data.code).toBe(`tipoAMano${ tag }`);
        });

        it('keeps the code when only the name changes on an update', async () => {
            const created = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Tipo renombrado ${ tag }` });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(`tipoRenombrado${ tag }`);

            const updated = await request(app)
                .put(`/api/catalog-types/${ created.body.data.catalogTypeId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Tipo renombrado ${ tag } bis` });

            expect(updated.status).toBe(200);
            expect(updated.body.data.code).toBe(`tipoRenombrado${ tag }`);
        });

        it('returns 400 when the code sent produces no usable identifier', async () => {
            const response = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ code: '---', name: `Codigo Invalido ${ tag }` });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('CATTYPE_001_CODE_NOT_VALID');
        });

    });

    /**
     * ESAVI-CATTYPE-002A/002B — SPEC F52. The entity had no text filter at all before this spec:
     * name and code are the canonical parameters, joined with Op.or, with no legacy search alias.
     * code is minted through toCodeFromInput, which strips '_' and every other separator as a word
     * boundary — so a catalogType code can never carry a literal '_' the way geoLevelType's or
     * appRole's CONSTANT_CASE codes do, and the escape case of §5 does not apply to this entity: the
     * queries below build their code assertions off the code the server actually minted
     */
    describe('name/code search — SPEC F52', () => {

        const tag = `search${ Date.now().toString(36) }`;
        let findableId: string;
        let findableCode: string;
        let inactiveId: string;

        beforeAll(async () => {
            const findable = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Findable Type ${ tag }` });
            expect(findable.status).toBe(201);
            findableId = findable.body.data.catalogTypeId;
            findableCode = findable.body.data.code;

            const inactive = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Retired Type ${ tag }` });
            expect(inactive.status).toBe(201);
            inactiveId = inactive.body.data.catalogTypeId;
            const deleted = await request(app).delete(`/api/catalog-types/${ inactiveId }`).set(authHeader('ADMIN'));
            expect(deleted.status).toBe(200);
        });

        const list = ( qs: string, role: 'USER' | 'SUPERADMIN' = 'USER' ) =>
            request(app).get(`/api/catalog-types?${ qs }&limit=100`).set(authHeader(role));

        it('name matches partially and case insensitively', async () => {
            const response = await list(`name=findable type ${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { catalogTypeId: string }) => r.catalogTypeId)).toContain(findableId);
        });

        it('code matches partially and case insensitively', async () => {
            const response = await list(`code=${ findableCode.toUpperCase() }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { catalogTypeId: string }) => r.catalogTypeId)).toEqual([findableId]);
        });

        it('name and code combine with Op.or — a match on either is enough', async () => {
            const response = await list(`name=noExisteEsteNombre${ tag }&code=${ findableCode }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { catalogTypeId: string }) => r.catalogTypeId)).toContain(findableId);
        });

        it('a USER never sees the inactive row', async () => {
            const response = await list(`name=Retired Type ${ tag }`);
            expect(response.status).toBe(200);
            expect(response.body.data.rows).toHaveLength(0);
        });

        it('a SUPERADMIN filtered read includes the inactive row', async () => {
            const response = await list(`name=Retired Type ${ tag }`, 'SUPERADMIN');
            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { catalogTypeId: string }) => r.catalogTypeId)).toContain(inactiveId);
        });

        it('?name=a (one character) responds 400; ?name=ab responds 200', async () => {
            expect((await list('name=a')).status).toBe(400);
            expect((await list('name=ab')).status).toBe(200);
        });

        it('no parameter still returns the unfiltered catalog, exactly as before this spec', async () => {
            const response = await list('');
            expect(response.status).toBe(200);
            expect(response.body.data.rows.length).toBeGreaterThan(0);
        });

    });

});
