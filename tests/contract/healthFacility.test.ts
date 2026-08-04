import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';

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
        // The second one is the vehicle for the wrong-catalog test
        const facilityType = await CatalogItem.findOne({
            where: { code: 'HOSPITAL' },
            include: [{ model: CatalogType, as: 'catalogType', where: { code: 'healthFacilityType' }, attributes: [] }]
        });
        const wrongCatalogItem = await CatalogItem.findOne({
            where: { code: 'FEMALE' },
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

});
