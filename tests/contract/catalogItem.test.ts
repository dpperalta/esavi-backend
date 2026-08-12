import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * catalogItem has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-CATITEM-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 */
describe('catalogItem contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    let catalogTypeId: string;

    beforeAll(async () => {
        await seedTestUsers();

        const catalogType = await request(app)
            .post('/api/catalog-types')
            .set(authHeader('SUPERADMIN'))
            .send({ code: `differentialItem${ suffix }`, name: `Differential Item ${ suffix }` });

        expect(catalogType.status).toBe(201);
        catalogTypeId = catalogType.body.data.catalogTypeId;
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({
                    catalogTypeId,
                    code: `differential ${ suffix }`,
                    name: `differential ${ suffix }`,
                    value: 'DIFFERENTIAL',
                    description: 'Catalog item of the differential update case',
                    metadata: { source: 'SPEC F12' },
                    sortOrder: 1
                });

            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/catalog-items',
                id: created.body.data.catalogItemId,
                model: CatalogItem,
                role: 'SUPERADMIN'
            });
        });

    });

});
