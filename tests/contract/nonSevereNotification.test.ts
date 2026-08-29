import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, GeoLevelType, GeoLocation, HealthFacility, Notification, NonSevereNotification, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the five nonSevereNotification operations of SPEC F14. It walks
 * the entity end to end — create, read by id, read by case, update, drag, purge —
 * and covers what cannot be checked by hand reliably.
 *
 * This is the second entity of the repository whose table has no isActive column, and
 * it inherits from severeNotification everything that follows from that: no 005A, no
 * 005B, no listing at all, visibility inherited from notification.isActive, deletedAt
 * as the only status mark the row carries, and a purge guarded by that seal because
 * the isActive check of purgeEntityService is inert here.
 *
 * What is new, and what this suite therefore has to prove beyond the F13 one, is the
 * three foreign keys of its own. They are a historical record of where the vaccination
 * happened, not live pointers, and two consequences follow: the reads never filter
 * them by isActive, and the update revalidates one only when its value really changes.
 * A PUT resending the whole GET stays inert even after a health facility was retired
 * in the meantime — the case this suite calls "the historical one".
 *
 * Plus the other source rule, evaluated over the resulting state on update and not
 * over the body, the geographic level restricted to the deepest seeded one, and the
 * tri-state of the six boolean fields, where null is a value of its own — the form did
 * not collect the answer — and never becomes false.
 */
describe('nonSevereNotification contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // The data preconditions the spec declares: the vaccinationSite catalog and a
    // geographic tree with at least one level below the root
    let siteItemId: string;
    let otherCatalogItemId: string;
    let deepGeoLocationId: string;
    let shallowGeoLocationId: string;
    let activeFacilityId: string;
    let inactiveFacilityId: string;

    // Every case is minted fresh: the chain case -> notification -> detail is one to one on
    // both hops, so two tests cannot share one
    const createCaseFixture = async (): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`NonSevere ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`NS${ caseCounter }${ suffix }`),
            healthSystemCode: `NS${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `NS${ caseCounter }${ suffix }`,
            name: `NonSevere ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `NS-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification of the given type over a brand new case. The non severe detail needs a
    // NON_SEVERE header, which is the only fixture precondition of the whole suite
    const notifyNewCase = async (
        notificationType: string = 'NON_SEVERE'
    ): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType, esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createDetail = ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).post('/api/non-severe-notifications').set(authHeader(role)).send(payload);

    const getDetail = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/non-severe-notifications/${ id }`).set(authHeader(role));

    const getDetailByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/non-severe-notifications/case/${ caseId }`).set(authHeader(role));

    const updateDetail = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/non-severe-notifications/${ id }`).set(authHeader(role)).send(payload);

    const purgeDetail = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/non-severe-notifications/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    const reactivateNotification = ( id: string ) =>
        request(app).patch(`/api/notifications/activate/${ id }`).set(authHeader('SUPERADMIN'));

    // A brand new detail over its own case, ready to be read or updated
    const newDetail = async ( payload: Record<string, unknown> = {} ): Promise<string> => {
        const { notificationId } = await notifyNewCase();
        await createDetail({ notificationId, ...payload });
        return notificationId;
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NonSevereNotification.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const sysVersion = async ( id: string ): Promise<number | undefined> => {
        const row = await NonSevereNotification.findByPk(id);
        return ( row?.getDataValue('sysDetails') as { version?: number } | null )?.version;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        // The vaccinationSite catalog. Without it every vaccinationSiteItemId falls in a 404,
        // which is the deployment precondition of the spec.
        // Reused if it is already there: esaviapp.sql does not seed this catalogType, and since
        // SPEC F28 the investigation suite is a second consumer of the same precondition. Its code
        // is unique in catalogType, so two suites creating it blindly is a 23505 for whichever
        // runs second
        const siteType = await CatalogType.findOne({ where: { code: 'vaccinationSite' } })
            ?? await CatalogType.create({ code: 'vaccinationSite', name: `Vaccination Site ${ suffix }` });
        const siteItem = await CatalogItem.create({
            catalogTypeId: siteType.getDataValue('catalogTypeId'),
            code: `FIXED_POST_${ suffix }`,
            name: `Fixed Post ${ suffix }`,
            value: `Fixed Post ${ suffix }`
        });
        siteItemId = siteItem.getDataValue('catalogItemId');

        // An active item of another catalogType: a valid UUID pointing at a meaningless site
        const otherType = await CatalogType.create({ code: `otherCatalog${ suffix }`, name: `Other ${ suffix }` });
        const otherItem = await CatalogItem.create({
            catalogTypeId: otherType.getDataValue('catalogTypeId'),
            code: `OTHER_${ suffix }`,
            name: `Other ${ suffix }`,
            value: `Other ${ suffix }`
        });
        otherCatalogItemId = otherItem.getDataValue('catalogItemId');

        // The maximum level is global, so the two fixtures are seeded above whatever the database
        // already holds: the child ends up being the deepest level of the whole tree
        const currentMax = ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) || 0;
        const levelType = await GeoLevelType.create({ code: `LVL_${ suffix }`, name: `Level ${ suffix }`, sortOrder: 1 });
        const root = await GeoLocation.create({
            geoLevelTypeId: levelType.getDataValue('geoLevelTypeId'),
            code: `ROOT_${ suffix }`,
            name: `Root ${ suffix }`,
            level: currentMax + 1
        });
        shallowGeoLocationId = root.getDataValue('geoLocationId');
        const child = await GeoLocation.create({
            geoLevelTypeId: levelType.getDataValue('geoLevelTypeId'),
            parentGeoLocationId: shallowGeoLocationId,
            code: `CHILD_${ suffix }`,
            name: `Child ${ suffix }`,
            level: currentMax + 2
        });
        deepGeoLocationId = child.getDataValue('geoLocationId');

        const active = await HealthFacility.create({ localCode: `ACT${ suffix }`, name: `Active ${ suffix }` });
        activeFacilityId = active.getDataValue('healthFacilityId');
        const inactive = await HealthFacility.create({ localCode: `INA${ suffix }`, name: `Inactive ${ suffix }`, isActive: false });
        inactiveFacilityId = inactive.getDataValue('healthFacilityId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the walkthrough', () => {

        it('goes create -> get -> get by case -> update -> drag -> purge', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            // Create
            const created = await createDetail({ notificationId, vaccinationCenterAddress: 'Main street 1' });
            expect(created.status).toBe(201);
            expect(created.body.data.deletedAt).toBeNull();

            // Get by id
            expect(( await getDetail(notificationId) ).status).toBe(200);

            // Get by case
            const byCase = await getDetailByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.notificationId).toBe(notificationId);

            // Update
            const updated = await updateDetail(notificationId, { notes: 'a note' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.notes).toBe('a note');

            // Purging before the drag is refused: the seal is the safety net
            expect(( await purgeDetail(notificationId) ).status).toBe(409);

            // Drag, by deactivating the header
            expect(( await deactivateNotification(notificationId) ).status).toBe(200);
            expect(( await NonSevereNotification.findByPk(notificationId) )?.getDataValue('deletedAt')).not.toBeNull();

            // Purge
            expect(( await purgeDetail(notificationId) ).status).toBe(200);
            expect(await NonSevereNotification.findByPk(notificationId)).toBeNull();
        });

    });

    describe('ESAVI-NSEVNOT-001 — create', () => {

        it('creates a minimal detail with the six tri-states and the three keys null', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId });

            expect(response.status).toBe(201);
            const data = response.body.data;
            for( const field of [ 'verifiedPhysicalDocument', 'verifiedElectronicRecord', 'verifiedVerbalReport',
                'verifiedClinicalRecord', 'verifiedUnknown', 'verifiedOtherSource' ] ) {
                expect(data[field]).toBeNull();
            }
            expect(data.vaccinationHealthFacility).toBeNull();
            expect(data.vaccinationSite).toBeNull();
            expect(data.vaccinationGeoLocation).toBeNull();
            expect(data.deletedAt).toBeNull();
            // The table has no isActive column, so no response of the entity carries one
            expect(data).not.toHaveProperty('isActive');
            expect(data.notification.isActive).toBe(true);
        });

        it('answers 409 when the notification already has a non severe detail', async () => {
            const { notificationId } = await notifyNewCase();
            expect(( await createDetail({ notificationId }) ).status).toBe(201);

            const repeated = await createDetail({ notificationId });
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('NSEVNOT_001_ALREADY_EXISTS');
            expect(repeated.body.message).toContain(notificationId);
        });

        it('answers 409 and not 400 when the notification is SEVERE', async () => {
            const { notificationId } = await notifyNewCase('SEVERE');
            const response = await createDetail({ notificationId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NSEVNOT_001_NOTIFICATION_NOT_NON_SEVERE');
            expect(response.body.message).toContain(notificationId);
        });

        it('answers 404 for a notification that does not exist or is inactive', async () => {
            expect(( await createDetail({ notificationId: unknownUuid }) ).status).toBe(404);

            const { notificationId } = await notifyNewCase();
            await deactivateNotification(notificationId);
            const response = await createDetail({ notificationId });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_001_NOTIFICATION_NOT_FOUND');
        });

        it('accepts the six verification sources as independent of each other', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({
                notificationId,
                verifiedPhysicalDocument: true,
                verifiedUnknown: true
            });
            expect(response.status).toBe(201);
            expect(response.body.data.verifiedPhysicalDocument).toBe(true);
            expect(response.body.data.verifiedUnknown).toBe(true);
        });

        it('answers 400 for a verification source that is not a boolean, never 500', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId, verifiedUnknown: 'MAYBE' });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            // The envelope of validateFields, never the 22P02 Postgres would raise
            expect(response.body.errors).toContain('Verified Unknown must be a boolean');
        });

        it('answers 400 for an address longer than 250 characters, never a Postgres error', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId, vaccinationCenterAddress: 'x'.repeat(251) });
            expect(response.status).toBe(400);

            const accepted = await createDetail({ notificationId, vaccinationCenterAddress: 'x'.repeat(250) });
            expect(accepted.status).toBe(201);
        });

        it('stores a single audit entry carrying the operation code', async () => {
            const id = await newDetail();
            expect(await auditMethods(id)).toEqual([ 'ESAVI-NSEVNOT-001' ]);
        });

    });

    describe('the three foreign keys', () => {

        it('answers 404 for a health facility that does not exist or is inactive', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId, vaccinationHealthFacilityId: inactiveFacilityId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_001_HEALTH_FACILITY_NOT_FOUND');

            const accepted = await createDetail({ notificationId, vaccinationHealthFacilityId: activeFacilityId });
            expect(accepted.status).toBe(201);
        });

        it('answers 404 for a catalogItem outside the vaccinationSite catalog', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId, vaccinationSiteItemId: otherCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_001_VACCINATION_SITE_NOT_FOUND');

            const accepted = await createDetail({ notificationId, vaccinationSiteItemId: siteItemId });
            expect(accepted.status).toBe(201);
        });

        it('accepts only the deepest seeded geographic level', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({ notificationId, vaccinationGeoLocationId: shallowGeoLocationId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_001_GEOLOCATION_NOT_FOUND');

            const accepted = await createDetail({ notificationId, vaccinationGeoLocationId: deepGeoLocationId });
            expect(accepted.status).toBe(201);
        });

        it('gives the three 404 three codes distinct from each other and from notFound', async () => {
            const first = await notifyNewCase();
            const facility = await createDetail({ notificationId: first.notificationId, vaccinationHealthFacilityId: inactiveFacilityId });
            const site = await createDetail({ notificationId: first.notificationId, vaccinationSiteItemId: otherCatalogItemId });
            const geo = await createDetail({ notificationId: first.notificationId, vaccinationGeoLocationId: shallowGeoLocationId });
            const missing = await getDetail(unknownUuid);

            const codes = [ facility.body.code, site.body.code, geo.body.code, missing.body.code ];
            expect(new Set(codes).size).toBe(4);
        });

        it('accepts the three keys sent as null and writes them', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({
                notificationId,
                vaccinationHealthFacilityId: null,
                vaccinationSiteItemId: null,
                vaccinationGeoLocationId: null
            });

            expect(response.status).toBe(201);
            expect(response.body.data.vaccinationHealthFacility).toBeNull();
            expect(response.body.data.vaccinationSite).toBeNull();
            expect(response.body.data.vaccinationGeoLocation).toBeNull();
        });

        it('follows a newly seeded deeper level without restarting the process', async () => {
            const { notificationId } = await notifyNewCase();
            // Today the child is the deepest level and it is accepted
            expect(( await createDetail({ notificationId, vaccinationGeoLocationId: deepGeoLocationId }) ).status).toBe(201);

            const deepestLevel = await GeoLocation.max('level', { where: { isActive: true } });
            const levelType = await GeoLevelType.create({ code: `DEEP_${ suffix }`, name: `Deep ${ suffix }`, sortOrder: 2 });
            const grandChild = await GeoLocation.create({
                geoLevelTypeId: levelType.getDataValue('geoLevelTypeId'),
                parentGeoLocationId: deepGeoLocationId,
                code: `GRAND_${ suffix }`,
                name: `Grand ${ suffix }`,
                level: ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) + 1
            });

            // The maximum moved, so the one that passed a moment ago no longer does
            const now = await notifyNewCase();
            const rejected = await createDetail({ notificationId: now.notificationId, vaccinationGeoLocationId: deepGeoLocationId });
            expect(rejected.status).toBe(404);

            const accepted = await createDetail({
                notificationId: now.notificationId,
                vaccinationGeoLocationId: grandChild.getDataValue('geoLocationId')
            });
            expect(accepted.status).toBe(201);

            // Left as it was found, so the order of the tests does not matter. It is deactivated
            // and not destroyed: the maximum is computed over active locations, and geoLocation
            // is inside the preventPhysicalDelete loop of the DDL anyway
            await GeoLocation.update(
                { isActive: false },
                { where: { geoLocationId: grandChild.getDataValue('geoLocationId') } }
            );
            expect(await GeoLocation.max('level', { where: { isActive: true } })).toBe(deepestLevel);
        });

    });

    describe('the other source rule', () => {

        it('requires the description under YES, including a blank one', async () => {
            const { notificationId } = await notifyNewCase();
            const missing = await createDetail({ notificationId, verifiedOtherSource: true });
            expect(missing.status).toBe(400);
            expect(missing.body.code).toBe('NSEVNOT_001_OTHER_SOURCE_DESCRIPTION_REQUIRED');

            const blank = await createDetail({ notificationId, verifiedOtherSource: true, otherSourceDescription: '   ' });
            expect(blank.status).toBe(400);
            expect(blank.body.code).toBe('NSEVNOT_001_OTHER_SOURCE_DESCRIPTION_REQUIRED');
        });

        it('forbids the description under any other answer and under null', async () => {
            const { notificationId } = await notifyNewCase();
            const underFalse = await createDetail({ notificationId, verifiedOtherSource: false, otherSourceDescription: 'a source' });
            expect(underFalse.status).toBe(400);
            expect(underFalse.body.code).toBe('NSEVNOT_001_OTHER_SOURCE_DESCRIPTION_NOT_ALLOWED');

            const underNull = await createDetail({ notificationId, otherSourceDescription: 'a source' });
            expect(underNull.status).toBe(400);
            expect(underNull.body.code).toBe('NSEVNOT_001_OTHER_SOURCE_DESCRIPTION_NOT_ALLOWED');
        });

        it('accepts YES with a description, trimmed on write', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createDetail({
                notificationId,
                verifiedOtherSource: true,
                otherSourceDescription: '  a source  '
            });
            expect(response.status).toBe(201);
            expect(response.body.data.otherSourceDescription).toBe('a source');
        });

        it('accepts a create with the six sources null', async () => {
            const { notificationId } = await notifyNewCase();
            expect(( await createDetail({ notificationId }) ).status).toBe(201);
        });

        it('evaluates the rule over the resulting state on update', async () => {
            const id = await newDetail({ verifiedOtherSource: true, otherSourceDescription: 'a source' });

            // Moving off true without clearing the description leaves the text orphaned
            const orphan = await updateDetail(id, { verifiedOtherSource: false });
            expect(orphan.status).toBe(400);
            expect(orphan.body.code).toBe('NSEVNOT_004_OTHER_SOURCE_DESCRIPTION_NOT_ALLOWED');

            // Clearing it in the same PUT is what the rule asks for
            const cleared = await updateDetail(id, { verifiedOtherSource: false, otherSourceDescription: null });
            expect(cleared.status).toBe(200);
            expect(cleared.body.data.otherSourceDescription).toBeNull();
        });

        it('lets a PUT touching only notes through over a row holding true', async () => {
            const id = await newDetail({ verifiedOtherSource: true, otherSourceDescription: 'a source' });
            const response = await updateDetail(id, { notes: 'just a note' });

            expect(response.status).toBe(200);
            expect(response.body.data.otherSourceDescription).toBe('a source');
        });

    });

    describe('ESAVI-NSEVNOT-003 — get by id', () => {

        it('answers 404 for an id that does not exist', async () => {
            const response = await getDetail(unknownUuid);
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_003_NOT_FOUND');
        });

        it('returns the three resolved objects and no raw foreign keys', async () => {
            const { notificationId, caseId } = await notifyNewCase();
            await createDetail({
                notificationId,
                vaccinationHealthFacilityId: activeFacilityId,
                vaccinationSiteItemId: siteItemId,
                vaccinationGeoLocationId: deepGeoLocationId
            });

            const data = ( await getDetail(notificationId) ).body.data;
            expect(Object.keys(data.vaccinationHealthFacility).sort()).toEqual([ 'healthFacilityId', 'localCode', 'name' ]);
            expect(Object.keys(data.vaccinationSite).sort()).toEqual([ 'catalogItemId', 'code', 'name' ]);
            expect(Object.keys(data.vaccinationGeoLocation).sort()).toEqual([ 'geoLocationId', 'level', 'name' ]);

            expect(data).not.toHaveProperty('vaccinationHealthFacilityId');
            expect(data).not.toHaveProperty('vaccinationSiteItemId');
            expect(data).not.toHaveProperty('vaccinationGeoLocationId');

            expect(data.notification.case.caseId).toBe(caseId);
            expect(data).toHaveProperty('appDetails');
            expect(data).toHaveProperty('deletedAt');
        });

        it('never returns sysDetails, at any level', async () => {
            const id = await newDetail();
            const data = ( await getDetail(id) ).body.data;

            expect(data).not.toHaveProperty('sysDetails');
            expect(data.notification).not.toHaveProperty('sysDetails');
            expect(data.notification.case).not.toHaveProperty('sysDetails');
        });

        it('returns an uninformed foreign key as an explicit null, with the key present', async () => {
            const id = await newDetail();
            const data = ( await getDetail(id) ).body.data;

            expect(data).toHaveProperty('vaccinationHealthFacility', null);
            expect(data).toHaveProperty('vaccinationSite', null);
            expect(data).toHaveProperty('vaccinationGeoLocation', null);
        });

        it('inherits the visibility of its header: 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const id = await newDetail();
            await deactivateNotification(id);

            const asUser = await getDetail(id, 'USER');
            const asAdmin = await getDetail(id, 'ADMIN');
            const asSuperadmin = await getDetail(id, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asAdmin.status).toBe(404);
            // The same code as a row that does not exist: the cause is not distinguished
            expect(asUser.body.code).toBe('NSEVNOT_003_NOT_FOUND');
            expect(asAdmin.body.code).toBe('NSEVNOT_003_NOT_FOUND');

            expect(asSuperadmin.status).toBe(200);
            expect(asSuperadmin.body.data.notification.isActive).toBe(false);
        });

        it('returns 200 for a sealed row whose header is still active', async () => {
            const id = await newDetail();
            await NonSevereNotification.update({ deletedAt: new Date() }, { where: { notificationId: id } });

            const response = await getDetail(id);
            expect(response.status).toBe(200);
            expect(response.body.data.deletedAt).not.toBeNull();
        });

        it('answers 400 for an id that is not a UUID', async () => {
            expect(( await getDetail('not-a-uuid') ).status).toBe(400);
        });

    });

    describe('ESAVI-NSEVNOT-006 — get by case', () => {

        it('returns the record itself, not wrapped in a collection', async () => {
            const { notificationId, caseId } = await notifyNewCase();
            await createDetail({ notificationId });

            const response = await getDetailByCase(caseId);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(false);
            expect(response.body.data).not.toHaveProperty('count');
            expect(response.body.data).not.toHaveProperty('rows');
            expect(response.body.data.notificationId).toBe(notificationId);
        });

        it('answers three distinct 404, one per broken link of the chain', async () => {
            const noCase = await getDetailByCase(unknownUuid);
            expect(noCase.status).toBe(404);
            expect(noCase.body.code).toBe('NSEVNOT_006_CASE_NOT_FOUND');

            const bareCaseId = await createCaseFixture();
            const noNotification = await getDetailByCase(bareCaseId);
            expect(noNotification.status).toBe(404);
            expect(noNotification.body.code).toBe('NSEVNOT_006_NOTIFICATION_NOT_FOUND');

            const { caseId } = await notifyNewCase();
            const noDetail = await getDetailByCase(caseId);
            expect(noDetail.status).toBe(404);
            expect(noDetail.body.code).toBe('NSEVNOT_006_NOT_FOUND');

            expect(new Set([ noCase.body.code, noNotification.body.code, noDetail.body.code ]).size).toBe(3);
        });

        it('falls in the third 404 when the notification of the case is SEVERE', async () => {
            const { caseId } = await notifyNewCase('SEVERE');
            const response = await getDetailByCase(caseId);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NSEVNOT_006_NOT_FOUND');
        });

        it('applies the same canViewInactive rule as 003', async () => {
            const { notificationId, caseId } = await notifyNewCase();
            await createDetail({ notificationId });
            await deactivateNotification(notificationId);

            expect(( await getDetailByCase(caseId, 'USER') ).status).toBe(404);
            expect(( await getDetailByCase(caseId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 400 for a caseId that is not a UUID', async () => {
            expect(( await getDetailByCase('no-es-uuid') ).status).toBe(400);
        });

    });

    describe('ESAVI-NSEVNOT-004 — update', () => {

        it('ignores notificationId in the body and answers 200', async () => {
            const id = await newDetail();
            const other = await newDetail();

            const response = await updateDetail(id, { notificationId: other, notes: 'moved?' });
            expect(response.status).toBe(200);
            expect(response.body.data.notificationId).toBe(id);
            expect(await NonSevereNotification.findByPk(id)).not.toBeNull();
            expect(await NonSevereNotification.findByPk(other)).not.toBeNull();
        });

        it('dissociates a foreign key sent as null and leaves the others alone', async () => {
            const id = await newDetail({ vaccinationHealthFacilityId: activeFacilityId, vaccinationSiteItemId: siteItemId });

            const response = await updateDetail(id, { vaccinationHealthFacilityId: null });
            expect(response.status).toBe(200);
            expect(response.body.data.vaccinationHealthFacility).toBeNull();
            expect(response.body.data.vaccinationSite.catalogItemId).toBe(siteItemId);
            expect(( await NonSevereNotification.findByPk(id) )?.getDataValue('vaccinationHealthFacilityId')).toBeNull();
        });

        it('writes a tri-state moving between null and false in both directions', async () => {
            const id = await newDetail({ verifiedUnknown: false });

            const toNull = await updateDetail(id, { verifiedUnknown: null });
            expect(toNull.body.data.verifiedUnknown).toBeNull();
            expect(await auditMethods(id)).toHaveLength(2);

            const back = await updateDetail(id, { verifiedUnknown: false });
            expect(back.body.data.verifiedUnknown).toBe(false);
            expect(await auditMethods(id)).toHaveLength(3);
        });

        it('answers 404 for an unknown id and for a detail whose header is inactive', async () => {
            const unknown = await updateDetail(unknownUuid, { notes: 'x' });
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('NSEVNOT_004_NOT_FOUND');

            const id = await newDetail();
            await deactivateNotification(id);
            expect(( await updateDetail(id, { notes: 'x' }) ).status).toBe(404);
        });

    });

    describe('the historical criterion', () => {

        it('keeps returning the facility object after the facility is deactivated', async () => {
            const facility = await HealthFacility.create({ localCode: `HIS${ suffix }`, name: `Historic ${ suffix }` });
            const facilityId = facility.getDataValue('healthFacilityId');
            const id = await newDetail({ vaccinationHealthFacilityId: facilityId });

            await HealthFacility.update({ isActive: false }, { where: { healthFacilityId: facilityId } });

            const data = ( await getDetail(id) ).body.data;
            expect(data.vaccinationHealthFacility).not.toBeNull();
            expect(data.vaccinationHealthFacility.healthFacilityId).toBe(facilityId);
        });

        it('answers 200 to a PUT resending that same key, and 404 to one changing it', async () => {
            const facility = await HealthFacility.create({ localCode: `HI2${ suffix }`, name: `Historic 2 ${ suffix }` });
            const facilityId = facility.getDataValue('healthFacilityId');
            const id = await newDetail({ vaccinationHealthFacilityId: facilityId });

            await HealthFacility.update({ isActive: false }, { where: { healthFacilityId: facilityId } });

            // Resending it unchanged is inert: the row is historical, not a live pointer
            const resent = await updateDetail(id, { vaccinationHealthFacilityId: facilityId, notes: 'still here' });
            expect(resent.status).toBe(200);

            // Changing it to another inactive target is a real change and gets revalidated
            const changed = await updateDetail(id, { vaccinationHealthFacilityId: inactiveFacilityId });
            expect(changed.status).toBe(404);
            expect(changed.body.code).toBe('NSEVNOT_004_HEALTH_FACILITY_NOT_FOUND');

            // And sending it null dissociates it without asking anything of the database
            const cleared = await updateDetail(id, { vaccinationHealthFacilityId: null });
            expect(cleared.status).toBe(200);
            expect(cleared.body.data.vaccinationHealthFacility).toBeNull();
        });

        it('revalidates the geographic level only when it changes', async () => {
            const id = await newDetail({ vaccinationGeoLocationId: deepGeoLocationId });

            expect(( await updateDetail(id, { vaccinationGeoLocationId: deepGeoLocationId }) ).status).toBe(200);

            const changed = await updateDetail(id, { vaccinationGeoLocationId: shallowGeoLocationId });
            expect(changed.status).toBe(404);
            expect(changed.body.code).toBe('NSEVNOT_004_GEOLOCATION_NOT_FOUND');
        });

    });

    describe('the differential update', () => {

        it('writes nothing when the whole GET response is sent back', async () => {
            const id = await newDetail({
                vaccinationHealthFacilityId: activeFacilityId,
                vaccinationSiteItemId: siteItemId,
                vaccinationGeoLocationId: deepGeoLocationId,
                vaccinationCenterAddress: 'Main street 1',
                verifiedPhysicalDocument: true,
                notes: 'a note'
            });
            await expectPutOfGetResponseWritesNothing({
                path: '/api/non-severe-notifications',
                id,
                model: NonSevereNotification,
                role: 'USER'
            });
        });

        it('behaves the same for an empty body, and writes one entry for a single change', async () => {
            const id = await newDetail({ notes: 'original' });
            const auditBefore = ( await auditMethods(id) ).length;
            const versionBefore = await sysVersion(id);

            expect(( await updateDetail(id, {}) ).status).toBe(200);
            expect(( await auditMethods(id) ).length).toBe(auditBefore);
            expect(await sysVersion(id)).toBe(versionBefore);

            expect(( await updateDetail(id, { notes: 'changed' }) ).status).toBe(200);
            const methods = await auditMethods(id);
            expect(methods.length).toBe(auditBefore + 1);
            expect(methods[methods.length - 1]).toBe('ESAVI-NSEVNOT-004');
            expect(await sysVersion(id)).toBe(( versionBefore as number ) + 1);
        });

        it('normalizes the free texts before comparing, so surrounding blanks are not a change', async () => {
            const id = await newDetail({ notes: 'a note' });
            const auditBefore = ( await auditMethods(id) ).length;

            expect(( await updateDetail(id, { notes: '   a note   ' }) ).status).toBe(200);
            expect(( await auditMethods(id) ).length).toBe(auditBefore);
        });

    });

    describe('the drag from its header', () => {

        it('seals the detail on 005A and clears it on 005B, keeping the history', async () => {
            const id = await newDetail();

            await deactivateNotification(id);
            expect(( await NonSevereNotification.findByPk(id) )?.getDataValue('deletedAt')).not.toBeNull();
            expect(await auditMethods(id)).toEqual([ 'ESAVI-NSEVNOT-001', 'ESAVI-NOTIFCN-005A' ]);

            await reactivateNotification(id);
            expect(( await NonSevereNotification.findByPk(id) )?.getDataValue('deletedAt')).toBeNull();
            expect(await auditMethods(id)).toEqual([ 'ESAVI-NSEVNOT-001', 'ESAVI-NOTIFCN-005A', 'ESAVI-NOTIFCN-005B' ]);
        });

        it('leaves an already sealed detail with its original date and no new entry', async () => {
            const id = await newDetail();
            const originalSeal = new Date('2020-01-01T00:00:00.000Z');
            await NonSevereNotification.update({ deletedAt: originalSeal }, { where: { notificationId: id } });
            const methodsBefore = await auditMethods(id);

            await deactivateNotification(id);

            const row = await NonSevereNotification.findByPk(id);
            expect(new Date(row?.getDataValue('deletedAt') as Date).getTime()).toBe(originalSeal.getTime());
            expect(await auditMethods(id)).toEqual(methodsBefore);
        });

        it('never writes a method of the form ESAVI-NSEVNOT-005*', async () => {
            const id = await newDetail();
            await deactivateNotification(id);
            await reactivateNotification(id);

            expect(( await auditMethods(id) ).some(method => method.startsWith('ESAVI-NSEVNOT-005'))).toBe(false);
        });

    });

    describe('ESAVI-NSEVNOT-005C — purge', () => {

        it('answers 409 for a detail that was never dragged, and the row survives', async () => {
            const id = await newDetail();
            const response = await purgeDetail(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NSEVNOT_005C_NOT_DELETED');
            expect(response.body.message).toContain(id);
            expect(await NonSevereNotification.findByPk(id)).not.toBeNull();
        });

        it('destroys the row once it is dragged, answers without data, and 404 on repeat', async () => {
            const id = await newDetail();
            await deactivateNotification(id);

            const response = await purgeDetail(id);
            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');
            expect(await NonSevereNotification.findByPk(id)).toBeNull();

            const repeated = await purgeDetail(id);
            expect(repeated.status).toBe(404);
            expect(repeated.body.code).toBe('NSEVNOT_005C_NOT_FOUND');
        });

        it('answers 403 for an ADMIN and leaves the row where it was', async () => {
            const id = await newDetail();
            await deactivateNotification(id);

            expect(( await purgeDetail(id, 'ADMIN') ).status).toBe(403);
            expect(await NonSevereNotification.findByPk(id)).not.toBeNull();
        });

        it('leaves the notification and the three referenced rows intact', async () => {
            const id = await newDetail({
                vaccinationHealthFacilityId: activeFacilityId,
                vaccinationSiteItemId: siteItemId,
                vaccinationGeoLocationId: deepGeoLocationId
            });
            await deactivateNotification(id);
            expect(( await purgeDetail(id) ).status).toBe(200);

            expect(await Notification.findByPk(id)).not.toBeNull();
            expect(await HealthFacility.findByPk(activeFacilityId)).not.toBeNull();
            expect(await CatalogItem.findByPk(siteItemId)).not.toBeNull();
            expect(await GeoLocation.findByPk(deepGeoLocationId)).not.toBeNull();
        });

    });

});
