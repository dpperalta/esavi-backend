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

});
