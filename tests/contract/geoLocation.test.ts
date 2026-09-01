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

    describe('GET /api/geo-locations — name/code text filters — SPEC F50', () => {

        let parentId: string;
        let nameMatchId: string;
        let isoOnlyMatchId: string;
        let underscoreCodeId: string;

        beforeAll(async () => {
            const parent = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `TextFilterParent ${ suffix }`,
                    externalCode: `TXTPARENT${ suffix }`
                });
            expect(parent.status).toBe(201);
            parentId = parent.body.data.geoLocationId;

            const nameMatch = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `Quito ${ suffix }`,
                    externalCode: `QUITO${ suffix }`
                });
            expect(nameMatch.status).toBe(201);
            nameMatchId = nameMatch.body.data.geoLocationId;

            // externalCode intentionally does not contain the search token; only isoCode does
            const isoOnlyMatch = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `NoNameMatch ${ suffix }`,
                    externalCode: `OTHERCODE${ suffix }`,
                    isoCode: `ISOTOK${ suffix }`.slice(0, 10)
                });
            expect(isoOnlyMatch.status).toBe(201);
            isoOnlyMatchId = isoOnlyMatch.body.data.geoLocationId;

            const underscoreCode = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `Underscore ${ suffix }`,
                    externalCode: `A_B${ suffix }`
                });
            expect(underscoreCode.status).toBe(201);
            underscoreCodeId = underscoreCode.body.data.geoLocationId;

            await request(app)
                .delete(`/api/geo-locations/${ isoOnlyMatchId }`)
                .set(authHeader('ADMIN'));
        });

        it('filters by partial, case-insensitive name', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`.toUpperCase(), parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).not.toContain(underscoreCodeId);
        });

        it('filters by code matching externalCode', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `QUITO${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
        });

        it('a row whose isoCode matches but whose externalCode does not still matches code=X, only visible to roles that can view inactive', async () => {
            const asSuperAdmin = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('SUPERADMIN'))
                .query({ code: `ISOTOK${ suffix }`.slice(0, 10), parentId });

            expect(asSuperAdmin.status).toBe(200);
            const superAdminIds = asSuperAdmin.body.data.rows.map((row: any) => row.geoLocationId);
            expect(superAdminIds).toContain(isoOnlyMatchId);

            const asUser = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `ISOTOK${ suffix }`.slice(0, 10), parentId });

            expect(asUser.status).toBe(200);
            const userIds = asUser.body.data.rows.map((row: any) => row.geoLocationId);
            expect(userIds).not.toContain(isoOnlyMatchId);
        });

        it('name and code combine with OR, never requiring both at once', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`, code: `A_B${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).toContain(underscoreCodeId);
        });

        it('a text filter combines with geoLevelId/parentId using AND', async () => {
            const otherLevelType = await request(app)
                .post('/api/geo-level-types')
                .set(authHeader('ADMIN'))
                .send({ code: `OTHERLVL${ suffix }`, name: `Other Level ${ suffix }`, sortOrder: 2 });
            expect(otherLevelType.status).toBe(201);

            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`, geoLevelId: otherLevelType.body.data.geoLevelTypeId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).not.toContain(nameMatchId);
        });

        it('no name or code returns the same result as before this spec', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).toContain(underscoreCodeId);
            expect(ids).not.toContain(isoOnlyMatchId);
        });

        it('a name/code with no match responds 200 with count 0, never 404', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `NoSuchPlaceAtAll${ suffix }`, parentId });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
        });

        it('rejects a name longer than 200 characters', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: 'a'.repeat(201) });

            expect(response.status).toBe(400);
        });

        it('rejects a code longer than 100 characters', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: 'a'.repeat(101) });

            expect(response.status).toBe(400);
        });

        it('a literal underscore in code is not treated as a wildcard', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `AXB${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).not.toContain(underscoreCodeId);
        });

    });

});
