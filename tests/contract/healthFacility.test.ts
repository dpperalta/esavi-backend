import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType, HealthFacility } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * Contract suite for the seven healthFacility operations of SPEC 09. Unlike
 * `response.test.ts`, which pins the envelope, this one walks the entity end to
 * end and covers the five error paths that cannot be checked by hand reliably:
 * global `localCode` uniqueness, the facility-type catalog filter, the two
 * hierarchy cycles and the active-children guard on deactivation.
 */
describe('healthFacility contract', () => {

    const suffix = Date.now().toString(36);

    // Fixtures shared by the whole file: healthFacility needs a geoLocation, and
    // geoLocation needs a geoLevelType. The catalog items come seeded from esaviapp.sql
    let geoLocationId: string;
    let facilityTypeItemId: string;
    let wrongCatalogItemId: string;

    // errorHandler logs every error it handles, and half of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createFacility = async ( payload: Record<string, unknown> ) =>
        request(app)
            .post('/api/health-facilities')
            .set(authHeader('ADMIN'))
            .send({ geoLocationId, name: `Facility ${ suffix }`, ...payload });

    const createGeoLocationFixture = async ( geoLevelTypeId: string, label: string ): Promise<string> => {
        const response = await request(app)
            .post('/api/geo-locations')
            .set(authHeader('ADMIN'))
            .send({
                geoLevelTypeId,
                name: `${ label } ${ suffix }`,
                externalCode: `${ label.toUpperCase() }${ suffix.toUpperCase() }`
            });

        expect(response.status).toBe(201);

        return response.body.data.geoLocationId;
    };

    const createGeoLevelTypeFixture = async ( label: string, sortOrder: number ): Promise<string> => {
        const response = await request(app)
            .post('/api/geo-level-types')
            .set(authHeader('ADMIN'))
            .send({ code: `${ label }${ suffix }`, name: `${ label } ${ suffix }`, sortOrder });

        expect(response.status).toBe(201);

        return response.body.data.geoLevelTypeId;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const geoLevelTypeId = await createGeoLevelTypeFixture('hfacLevel', 1);
        geoLocationId = await createGeoLocationFixture(geoLevelTypeId, 'hfacLoc');

        // Seeded by esaviapp.sql: HOSPITAL belongs to healthFacilityType, FEMALE to sex.
        // The second one is the vehicle for the wrong-catalog test.
        // Resolved by value and not by code: sex is one of the 13 catalogs SPEC F46 found seeded
        // with a numeric code, so 'FEMALE' only matches the value column
        const facilityType = await CatalogItem.findOne({
            where: { value: 'HOSPITAL' },
            include: [{ model: CatalogType, as: 'catalogType', where: { code: 'healthFacilityType' }, attributes: [] }]
        });
        const wrongCatalogItem = await CatalogItem.findOne({
            where: { value: 'FEMALE' },
            include: [{ model: CatalogType, as: 'catalogType', where: { code: 'sex' }, attributes: [] }]
        });
        expect(facilityType).not.toBeNull();
        expect(wrongCatalogItem).not.toBeNull();
        facilityTypeItemId = facilityType?.catalogItemId as string;
        wrongCatalogItemId = wrongCatalogItem?.catalogItemId as string;
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('full lifecycle', () => {

        let healthFacilityId: string;

        // ESAVI-HFAC-001
        it('create responds 201 with the envelope and the normalized entity', async () => {
            const response = await createFacility({
                name: `lifecycle facility ${ suffix }`,
                localCode: `lifecycle ${ suffix }`,
                facilityTypeItemId
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data.healthFacilityId).toEqual(expect.any(String));
            expect(response.body.data.isActive).toBe(true);

            healthFacilityId = response.body.data.healthFacilityId;
        });

        // ESAVI-HFAC-003
        it('getById responds 200 with geoLocation, facilityType, parent and children', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.geoLocation).toEqual(
                expect.objectContaining({ geoLocationId, name: expect.any(String), level: expect.anything() })
            );
            expect(response.body.data.facilityType).toEqual(
                expect.objectContaining({ catalogItemId: facilityTypeItemId, code: 'HOSPITAL' })
            );
            // No parent was assigned and no children were created for this one
            expect(response.body.data.parent).toBeNull();
            expect(response.body.data.children).toEqual([]);
        });

        it('getById never exposes sysDetails', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('USER'));

            expect(response.body.data.sysDetails).toBeUndefined();
        });

        // ESAVI-HFAC-004
        it('update responds 200 and applies the change', async () => {
            const response = await request(app)
                .put(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ name: 'lifecycle renamed', address: 'Main street 42' });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.name).toBe('Lifecycle Renamed');
            expect(response.body.data.address).toBe('Main street 42');
        });

        it('update appends to appDetails without dropping the create entry', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'));

            const methods = response.body.data.appDetails.map(( entry: { method: string } ) => entry.method);

            expect(methods).toContain('ESAVI-HFAC-001');
            expect(methods).toContain('ESAVI-HFAC-004');
        });

        it('a PUT with no real change responds 200 and leaves the entity intact', async () => {
            const before = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'));

            const response = await request(app)
                .put(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ name: 'lifecycle renamed' });

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe(before.body.data.name);
            expect(response.body.data.appDetails).toHaveLength(before.body.data.appDetails.length);
        });

        // ESAVI-HFAC-002A
        it('the public listing returns the facility for its geoLocation', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/location/${ geoLocationId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBeGreaterThan(0);
            expect(response.body.data.rows.map(( row: { healthFacilityId: string } ) => row.healthFacilityId))
                .toContain(healthFacilityId);
        });

        // ESAVI-HFAC-002B
        it('the admin listing returns the facility for its geoLocation', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/admin/location/${ geoLocationId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.map(( row: { healthFacilityId: string } ) => row.healthFacilityId))
                .toContain(healthFacilityId);
        });

        // ESAVI-HFAC-005A — delete carries no data by contract
        it('delete responds 200 with ok and message, and no data', async () => {
            const response = await request(app)
                .delete(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toBeUndefined();
        });

        it('the deleted facility keeps isActive false and a deletedAt date', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.body.data.isActive).toBe(false);
            expect(response.body.data.deletedAt).not.toBeNull();
        });

        it('deleting twice responds 409', async () => {
            const response = await request(app)
                .delete(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_005A_ALREADY_INACTIVE');
        });

        // ESAVI-HFAC-005B — activate carries no data by contract
        it('activate responds 200 with ok and message, and no data', async () => {
            const response = await request(app)
                .patch(`/api/health-facilities/activate/${ healthFacilityId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data).toBeUndefined();
        });

        it('the reactivated facility clears deletedAt', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ healthFacilityId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.deletedAt).toBeNull();
        });

    });

    describe('normalization on write', () => {

        it('stores localCode in constant case and name in title case', async () => {
            const response = await createFacility({
                name: 'hospital central',
                localCode: `  hosp central ${ suffix }  `
            });

            expect(response.status).toBe(201);
            expect(response.body.data.name).toBe('Hospital Central');
            expect(response.body.data.localCode).toBe(`HOSP_CENTRAL_${ suffix.toUpperCase() }`);
        });

        it('accepts a facility without localCode', async () => {
            const response = await createFacility({ name: `no local code ${ suffix }` });

            expect(response.status).toBe(201);
            expect(response.body.data.localCode).toBeNull();
        });

    });

    describe('facility type must belong to the healthFacilityType catalog', () => {

        it('rejects a catalogItem from another catalog with 404, not 500', async () => {
            const response = await createFacility({
                name: `wrong type ${ suffix }`,
                facilityTypeItemId: wrongCatalogItemId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('HFAC_001_FACILITY_TYPE_NOT_FOUND');
        });

        it('rejects it on update too', async () => {
            const created = await createFacility({ name: `wrong type update ${ suffix }` });
            expect(created.status).toBe(201);

            const response = await request(app)
                .put(`/api/health-facilities/${ created.body.data.healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ facilityTypeItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('HFAC_004_FACILITY_TYPE_NOT_FOUND');
        });

    });

    describe('localCode uniqueness is global, not scoped by geoLocation', () => {

        const localCode = `unique${ suffix }`;
        let otherGeoLocationId: string;

        beforeAll(async () => {
            const geoLevelTypeId = await createGeoLevelTypeFixture('otherLevel', 2);
            otherGeoLocationId = await createGeoLocationFixture(geoLevelTypeId, 'otherLoc');

            const first = await createFacility({ name: `holder ${ suffix }`, localCode });
            expect(first.status).toBe(201);
        });

        it('rejects the same localCode in a different geoLocation with 409, not 500', async () => {
            const response = await request(app)
                .post('/api/health-facilities')
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: otherGeoLocationId, name: `clash ${ suffix }`, localCode });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_001_LOCAL_CODE_EXISTS');
        });

        it('rejects taking another facility localCode on update with 409', async () => {
            const created = await createFacility({ name: `clash update ${ suffix }` });
            expect(created.status).toBe(201);

            const response = await request(app)
                .put(`/api/health-facilities/${ created.body.data.healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ localCode });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_004_LOCAL_CODE_EXISTS');
        });

    });

    describe('hierarchy cycles', () => {

        let parentId: string;
        let childId: string;
        let grandchildId: string;

        beforeAll(async () => {
            const parent = await createFacility({ name: `cycle parent ${ suffix }` });
            parentId = parent.body.data.healthFacilityId;

            const child = await createFacility({
                name: `cycle child ${ suffix }`,
                parentHealthFacilityId: parentId
            });
            childId = child.body.data.healthFacilityId;

            const grandchild = await createFacility({
                name: `cycle grandchild ${ suffix }`,
                parentHealthFacilityId: childId
            });
            grandchildId = grandchild.body.data.healthFacilityId;
        });

        it('rejects a facility becoming its own parent with 409', async () => {
            const response = await request(app)
                .put(`/api/health-facilities/${ childId }`)
                .set(authHeader('ADMIN'))
                .send({ parentHealthFacilityId: childId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_004_SELF_PARENT');
        });

        it('rejects a direct descendant as parent with 409', async () => {
            const response = await request(app)
                .put(`/api/health-facilities/${ parentId }`)
                .set(authHeader('ADMIN'))
                .send({ parentHealthFacilityId: childId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_004_CIRCULAR_PARENT');
        });

        it('rejects an indirect descendant as parent with 409', async () => {
            const response = await request(app)
                .put(`/api/health-facilities/${ parentId }`)
                .set(authHeader('ADMIN'))
                .send({ parentHealthFacilityId: grandchildId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_004_CIRCULAR_PARENT');
        });

        it('accepts an unrelated facility as parent', async () => {
            const unrelated = await createFacility({ name: `cycle unrelated ${ suffix }` });

            const response = await request(app)
                .put(`/api/health-facilities/${ unrelated.body.data.healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ parentHealthFacilityId: grandchildId });

            expect(response.status).toBe(200);
            expect(response.body.data.parentHealthFacilityId).toBe(grandchildId);
        });

    });

    describe('deactivation is blocked while active children remain', () => {

        let parentId: string;
        let childId: string;

        beforeAll(async () => {
            const parent = await createFacility({ name: `children parent ${ suffix }` });
            parentId = parent.body.data.healthFacilityId;

            const child = await createFacility({
                name: `children child ${ suffix }`,
                parentHealthFacilityId: parentId
            });
            childId = child.body.data.healthFacilityId;
        });

        it('rejects deleting a parent with active children with 409', async () => {
            const response = await request(app)
                .delete(`/api/health-facilities/${ parentId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('HFAC_005A_HAS_ACTIVE_CHILDREN');
        });

        it('allows deleting the parent once the child is inactive', async () => {
            const child = await request(app)
                .delete(`/api/health-facilities/${ childId }`)
                .set(authHeader('ADMIN'));
            expect(child.status).toBe(200);

            const response = await request(app)
                .delete(`/api/health-facilities/${ parentId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
        });

    });

    /**
     * `getHealthFacilityByIdService` receives `canViewInactive(req.user)`, as SPEC 09 §4
     * prescribes and as every other entity does. That predicate grants SUPERADMIN only
     * (`permissions.helper.ts`), so ADMIN gets the same 404 as USER on an inactive row.
     * The acceptance criterion of the spec reads "200 for ADMIN", which does not match
     * the predicate it also mandates; these tests pin the behaviour of the code.
     */
    describe('visibility of inactive facilities', () => {

        let inactiveId: string;
        let parentId: string;

        beforeAll(async () => {
            const parent = await createFacility({ name: `visibility parent ${ suffix }` });
            parentId = parent.body.data.healthFacilityId;

            const inactive = await createFacility({
                name: `visibility child ${ suffix }`,
                parentHealthFacilityId: parentId
            });
            inactiveId = inactive.body.data.healthFacilityId;

            await request(app)
                .delete(`/api/health-facilities/${ inactiveId }`)
                .set(authHeader('ADMIN'));
        });

        it.each(['USER', 'ADMIN'] as const)('getById of an inactive facility responds 404 for %s', async ( role ) => {
            const response = await request(app)
                .get(`/api/health-facilities/${ inactiveId }`)
                .set(authHeader(role));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('HFAC_003_NOT_FOUND');
        });

        it('getById of an inactive facility responds 200 for SUPERADMIN', async () => {
            const response = await request(app)
                .get(`/api/health-facilities/${ inactiveId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.isActive).toBe(false);
        });

        it('inactive children are hidden from USER and listed for SUPERADMIN', async () => {
            const asUser = await request(app)
                .get(`/api/health-facilities/${ parentId }`)
                .set(authHeader('USER'));
            const asSuperAdmin = await request(app)
                .get(`/api/health-facilities/${ parentId }`)
                .set(authHeader('SUPERADMIN'));

            const userChildren = asUser.body.data.children.map(( row: { healthFacilityId: string } ) => row.healthFacilityId);
            const superAdminChildren = asSuperAdmin.body.data.children.map(( row: { healthFacilityId: string } ) => row.healthFacilityId);

            expect(userChildren).not.toContain(inactiveId);
            expect(superAdminChildren).toContain(inactiveId);
        });

        it('the public listing hides it while the admin listing shows it', async () => {
            const asUser = await request(app)
                .get(`/api/health-facilities/location/${ geoLocationId }?limit=100`)
                .set(authHeader('USER'));
            const asAdmin = await request(app)
                .get(`/api/health-facilities/admin/location/${ geoLocationId }?limit=100`)
                .set(authHeader('ADMIN'));

            const publicRows = asUser.body.data.rows.map(( row: { healthFacilityId: string } ) => row.healthFacilityId);
            const adminRows = asAdmin.body.data.rows.map(( row: { healthFacilityId: string } ) => row.healthFacilityId);

            expect(publicRows).not.toContain(inactiveId);
            expect(adminRows).toContain(inactiveId);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await createFacility({
                name: `differential facility ${ suffix }`,
                localCode: `differential ${ suffix }`,
                facilityTypeItemId,
                address: 'Av. Diferencial 12',
                phone: '022345678',
                email: 'diferencial@salud.ec',
                // DECIMAL(10, 7): `pg` reads them back as strings, so the GET response resends
                // '-0.2299000' against the -0.2299 that was stored
                latitude: -0.2299,
                longitude: -78.52495
            });
            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/health-facilities',
                id: created.body.data.healthFacilityId,
                model: HealthFacility,
                // parentHealthFacilityId is optional() but not nullable in the validator, so
                // resending the null the response carries is a 400. It is a validator gap of
                // SPEC 09, adjacent to DEUDA-040 and not part of this spec
                strip: ['parentHealthFacilityId']
            });
        });

        // The case above resends the response, where latitude is already the string `pg` gave
        // back, so a string-to-string comparison survives it. The leak only shows when the
        // client sends the number it sent on create, which is what a JSON form does
        it('a PUT resending the same latitude as a number writes nothing', async () => {
            const created = await createFacility({
                name: `decimal facility ${ suffix }`,
                localCode: `decimal ${ suffix }`,
                facilityTypeItemId,
                latitude: -0.2299,
                longitude: -78.52495
            });
            expect(created.status).toBe(201);

            const id = created.body.data.healthFacilityId;
            const before = await HealthFacility.findByPk(id);

            const response = await request(app)
                .put(`/api/health-facilities/${ id }`)
                .set(authHeader('ADMIN'))
                .send({ latitude: -0.2299, longitude: -78.52495 });

            expect(response.status).toBe(200);

            const after = await HealthFacility.findByPk(id);
            expect(( after!.getDataValue('appDetails') as unknown[] ).length)
                .toBe(( before!.getDataValue('appDetails') as unknown[] ).length);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

    });

    // SPEC F51 — ESAVI-HFAC-006. Every fixture below carries `tag` in the column under test, so a
    // search for it returns this block's rows and nothing the rest of the suite created
    describe('search by name or code — ESAVI-HFAC-006', () => {

        const tag = `vz${ suffix }`;
        // toTitleCase runs on create, so the stored name capitalizes every word of the
        // fixture. The search still hits it: Op.iLike ignores case
        const storedTag = `Vz${ suffix }`;
        const storedSuffix = suffix.charAt(0).toUpperCase() + suffix.slice(1);
        let otherGeoLocationId: string;

        const search = ( query: string, role: TestRole = 'USER' ) =>
            request(app)
                .get(`/api/health-facilities/search${ query }`)
                .set(authHeader(role));

        beforeAll(async () => {
            const otherLevelTypeId = await createGeoLevelTypeFixture('hfacSearchLevel', 2);
            otherGeoLocationId = await createGeoLocationFixture(otherLevelTypeId, 'hfacSearchLoc');

            // Matches through `name`, and the only one carrying a facilityType
            expect(( await createFacility({
                name: `Aaa hospital ${ tag }`,
                localCode: `search a ${ suffix }`,
                facilityTypeItemId
            }) ).status).toBe(201);

            // Matches through `officialName` only — `name` does not carry the tag
            expect(( await createFacility({
                name: `Bbb clinic ${ suffix }`,
                officialName: `Official ${ tag }`,
                localCode: `search b ${ suffix }`
            }) ).status).toBe(201);

            // Matches through `shortName` only
            expect(( await createFacility({
                name: `Ccc post ${ suffix }`,
                shortName: `SHORT${ tag }`,
                localCode: `search c ${ suffix }`
            }) ).status).toBe(201);

            // Matches through `localCode` only. toConstantCase turns the space into the literal
            // underscore this block needs to prove the escape
            expect(( await createFacility({
                name: `Ddd unrelated ${ suffix }`,
                localCode: `hvq 1${ tag }`
            }) ).status).toBe(201);

            // The decoy of the escape test: an X where the row above has the underscore
            expect(( await createFacility({
                name: `Eee unrelated ${ suffix }`,
                localCode: `hvqx1${ tag }`
            }) ).status).toBe(201);

            // Lives in the other geolocation — the vehicle of the conjunctive geoLocationId case
            const elsewhere = await request(app)
                .post('/api/health-facilities')
                .set(authHeader('ADMIN'))
                .send({
                    geoLocationId: otherGeoLocationId,
                    name: `Fff elsewhere ${ tag }`,
                    localCode: `search f ${ suffix }`
                });
            expect(elsewhere.status).toBe(201);

            // Deactivated right after creation: only roles that can view inactive rows see it
            const inactive = await createFacility({
                name: `Ggg inactive ${ tag }`,
                localCode: `search g ${ suffix }`
            });
            expect(inactive.status).toBe(201);
            expect(( await request(app)
                .delete(`/api/health-facilities/${ inactive.body.data.healthFacilityId }`)
                .set(authHeader('ADMIN')) ).status).toBe(200);
        });

        it('matches `name` regardless of case, including a hit in the middle of the string', async () => {
            const response = await search(`?name=${ tag.toUpperCase() }`);

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.rows.map(( row: { name: string } ) => row.name))
                .toEqual(expect.arrayContaining([`Aaa Hospital ${ storedTag }`]));
        });

        it('matches a row through `officialName` alone', async () => {
            const response = await search(`?name=${ tag }`);
            const names = response.body.data.rows.map(( row: { name: string } ) => row.name);

            expect(response.status).toBe(200);
            expect(names).toContain(`Bbb Clinic ${ storedSuffix }`);
        });

        it('matches a row through `shortName` alone', async () => {
            const response = await search(`?name=${ tag }`);
            const names = response.body.data.rows.map(( row: { name: string } ) => row.name);

            expect(response.status).toBe(200);
            expect(names).toContain(`Ccc Post ${ storedSuffix }`);
        });

        it('matches `localCode` through `code`, regardless of case', async () => {
            const response = await search(`?code=hvqx1${ tag }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(1);
            expect(response.body.data.rows[0].name).toBe(`Eee Unrelated ${ storedSuffix }`);
        });

        it('combines `name` and `code` disjunctively', async () => {
            const response = await search(`?name=${ tag }&code=hvqx1${ tag }`);
            const names = response.body.data.rows.map(( row: { name: string } ) => row.name);

            expect(response.status).toBe(200);
            // The Eee row matches the code but not the name, and is in the result anyway
            expect(names).toContain(`Eee Unrelated ${ storedSuffix }`);
            expect(names).toContain(`Aaa Hospital ${ storedTag }`);
        });

        it('combines `geoLocationId` conjunctively with the text block', async () => {
            const response = await search(`?name=${ tag }&geoLocationId=${ otherGeoLocationId }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(1);
            expect(response.body.data.rows[0].name).toBe(`Fff Elsewhere ${ storedTag }`);
        });

        it('without `geoLocationId` the search crosses every geolocation', async () => {
            const response = await search(`?name=${ tag }`);
            const names = response.body.data.rows.map(( row: { name: string } ) => row.name);

            expect(response.status).toBe(200);
            expect(names).toContain(`Aaa Hospital ${ storedTag }`);
            expect(names).toContain(`Fff Elsewhere ${ storedTag }`);
        });

        it('a `geoLocationId` that exists nowhere responds 200 with count 0, never 404', async () => {
            const response = await search(`?name=${ tag }&geoLocationId=00000000-0000-4000-8000-000000000000`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
        });

        it('no matching row is still a 200 with count 0', async () => {
            const response = await search(`?name=zzznothingmatches${ suffix }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
            expect(response.body.data.rows).toEqual([]);
        });

        it('without `name` and without `code` responds 400', async () => {
            const response = await search('');

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe('HFAC_006_SEARCH_CRITERIA_REQUIRED');
        });

        it('`geoLocationId` alone is not a criterion: narrowing is not searching', async () => {
            const response = await search(`?geoLocationId=${ otherGeoLocationId }`);

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('HFAC_006_SEARCH_CRITERIA_REQUIRED');
        });

        it('a single-character `name` responds 400, two characters respond 200', async () => {
            expect(( await search('?name=a') ).status).toBe(400);
            expect(( await search('?name=ab') ).status).toBe(200);
        });

        it('a `name` over 250 characters and a `code` over 200 respond 400', async () => {
            expect(( await search(`?name=${ 'a'.repeat(251) }`) ).status).toBe(400);
            expect(( await search(`?code=${ 'a'.repeat(201) }`) ).status).toBe(400);
        });

        it('a `geoLocationId` that is not a UUID responds 400', async () => {
            expect(( await search('?name=hospital&geoLocationId=notAUuid') ).status).toBe(400);
        });

        it('a literal underscore in `code` is not a wildcard', async () => {
            const response = await search(`?code=hvq_1${ tag }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(1);
            expect(response.body.data.rows[0].name).toBe(`Ddd Unrelated ${ storedSuffix }`);
        });

        it('a literal percent in `name` does not return the whole table', async () => {
            // Two percent signs, not one: the validator's minimum of 2 characters rejects a single one
            const response = await search('?name=%25%25');

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
        });

        it('a USER sees no inactive row while an ADMIN and a SUPERADMIN do', async () => {
            const asUser = await search(`?name=${ tag }`);
            const asAdmin = await search(`?name=${ tag }`, 'ADMIN');

            expect(asUser.body.data.rows.every(( row: { isActive: boolean } ) => row.isActive)).toBe(true);
            expect(asUser.body.data.rows.map(( row: { name: string } ) => row.name))
                .not.toContain(`Ggg Inactive ${ storedTag }`);
            expect(asAdmin.body.data.rows.map(( row: { name: string } ) => row.name))
                .toContain(`Ggg Inactive ${ storedTag }`);

            const asSuperAdmin = await search(`?name=${ tag }`, 'SUPERADMIN');
            expect(asSuperAdmin.body.data.rows.map(( row: { name: string } ) => row.name))
                .toContain(`Ggg Inactive ${ storedTag }`);
        });

        it('without a token the route responds 401', async () => {
            expect(( await request(app).get(`/api/health-facilities/search?name=${ tag }`) ).status).toBe(401);
        });

        it('no returned row carries sysDetails, and both associations come trimmed', async () => {
            const response = await search(`?name=${ tag }`);
            const rows = response.body.data.rows;

            expect(rows.every(( row: Record<string, unknown> ) => row.sysDetails === undefined)).toBe(true);

            const withType = rows.find(( row: { name: string } ) => row.name === `Aaa Hospital ${ storedTag }`);
            expect(Object.keys(withType.geoLocation).sort()).toEqual(['geoLocationId', 'name']);
            expect(Object.keys(withType.facilityType).sort()).toEqual(['catalogItemId', 'name']);

            // facilityTypeItemId is nullable, and the include carries no `required: true`, so a
            // facility with no type must still show up — with facilityType null
            const withoutType = rows.find(( row: { name: string } ) => row.name === `Fff Elsewhere ${ storedTag }`);
            expect(withoutType).not.toBeUndefined();
            expect(withoutType.facilityType).toBeNull();
        });

        it('rows come ordered by name ascending, and limit paginates without changing count', async () => {
            const response = await search(`?name=${ tag }`);
            const names = response.body.data.rows.map(( row: { name: string } ) => row.name);

            expect(names).toEqual([...names].sort());

            const firstPage = await search(`?name=${ tag }&limit=1`);
            expect(firstPage.body.data.rows).toHaveLength(1);
            expect(firstPage.body.data.count).toBe(response.body.data.count);
            expect(firstPage.body.data.rows[0].name).toBe(names[0]);
        });

    });

});
