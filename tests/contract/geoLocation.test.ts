import request from 'supertest';
import { app } from '../../src/app';
import { GeoLocation } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * geoLocation has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-GEOLOC-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 *
 * The case matters more here than anywhere else: latitude and longitude are DECIMAL(10, 7) and
 * `pg` reads them back as strings, so before SPEC F12 every PUT resending its own coordinates
 * rewrote the row. The comparison that closed it is numeric and lives in the helper.
 */
describe('geoLocation contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    let geoLevelTypeId: string;

    beforeAll(async () => {
        await seedTestUsers();

        const geoLevelType = await request(app)
            .post('/api/geo-level-types')
            .set(authHeader('ADMIN'))
            .send({ code: `DIFFLOC${ suffix }`, name: `Differential Location ${ suffix }`, sortOrder: 1 });

        expect(geoLevelType.status).toBe(201);
        geoLevelTypeId = geoLevelType.body.data.geoLevelTypeId;
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `Differential ${ suffix }`,
                    officialName: `Differential Official ${ suffix }`,
                    shortName: `DIFF ${ suffix }`,
                    isoCode: 'EC',
                    externalCode: `DIFFLOC${ suffix }`,
                    latitude: -0.2299,
                    longitude: -78.52495,
                    sortOrder: 1
                });

            expect(created.status).toBe(201);
            // The stored value is a string and the body carried a number: the row this case
            // resends is exactly the one that used to be rewritten on every PUT
            expect(typeof created.body.data.latitude).toBe('string');

            await expectPutOfGetResponseWritesNothing({
                path: '/api/geo-locations',
                id: created.body.data.geoLocationId,
                model: GeoLocation,
                // parentGeoLocationId is optional() but not nullable in the validator, so
                // resending the null the response carries is a 400 — the same validator gap
                // healthFacility has with its own parent, and neither belongs to this spec
                strip: ['parentGeoLocationId']
            });
        });

        // The case above resends the response, where latitude is already the string `pg` gave
        // back, so a string-to-string comparison survives it. The leak only shows when the
        // client sends the number it sent on create, which is what a JSON form does
        it('a PUT resending the same latitude as a number writes nothing', async () => {
            const created = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `Decimal ${ suffix }`,
                    externalCode: `DECIMAL${ suffix }`,
                    latitude: -0.2299,
                    longitude: -78.52495
                });
            expect(created.status).toBe(201);

            const id = created.body.data.geoLocationId;
            const before = await GeoLocation.findByPk(id);

            const response = await request(app)
                .put(`/api/geo-locations/${ id }`)
                .set(authHeader('ADMIN'))
                .send({ latitude: -0.2299, longitude: -78.52495 });

            expect(response.status).toBe(200);

            const after = await GeoLocation.findByPk(id);
            expect(( after!.getDataValue('appDetails') as unknown[] ).length)
                .toBe(( before!.getDataValue('appDetails') as unknown[] ).length);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

    });

});
