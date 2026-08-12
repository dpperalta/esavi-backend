import request from 'supertest';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { AppUserGeoLocation, GeoLocation } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader, getTestUser } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * Contract suite for the ten appUserGeoLocation operations of SPEC F01. It walks the
 * entity end to end and pins the four rules that no other suite can check:
 *
 *  - the one-row-per-(userId, geoLocationId) invariant, which is stricter than the
 *    partial unique index of the DDL and turns a would-be 23505/500 into a 409;
 *  - the coherent close, where 005A writes validTo alongside isActive and deletedAt;
 *  - the all-or-nothing semantics of 006 and 007, verified through their rollback;
 *  - the recursive CTE of 008 over a province with two cantons and four parishes.
 *
 * The three scenarios use three different users so their assignments never overlap:
 * USER for the walkthrough, ANALYTICS for the bulk paths and ADMIN for the coverage tree.
 */
describe('appUserGeoLocation contract', () => {

    const suffix = Date.now().toString(36);
    const ghostId = '11111111-1111-4111-8111-111111111111';

    let geoLevelTypeId: string;

    // Walkthrough fixtures
    let walkUserId: string;
    let originGeoId: string;
    let targetGeoId: string;
    let spareGeoId: string;
    let assignmentId: string;

    // Bulk fixtures
    let bulkUserId: string;

    // Coverage tree
    let coverageUserId: string;
    let provinceId: string;
    let cantonAId: string;
    let parishA1Id: string;

    // errorHandler logs every error it handles, and a good half of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createGeoLocation = async ( label: string, level: number, parentGeoLocationId?: string ): Promise<string> => {
        const response = await request(app)
            .post('/api/geo-locations')
            .set(authHeader('ADMIN'))
            .send({
                geoLevelTypeId,
                name: `${ label } ${ suffix }`,
                externalCode: `${ label.toUpperCase() }${ suffix.toUpperCase() }`,
                level,
                ...( parentGeoLocationId ? { parentGeoLocationId } : {} )
            });

        expect(response.status).toBe(201);

        return response.body.data.geoLocationId;
    };

    const assign = ( userId: string, geoLocationId: string, payload: Record<string, unknown> = {} ) =>
        request(app)
            .post('/api/user-geo-locations')
            .set(authHeader('ADMIN'))
            .send({ userId, geoLocationId, ...payload });

    const bulkAssign = ( userId: string, geoLocationIds: string[], payload: Record<string, unknown> = {} ) =>
        request(app)
            .post('/api/user-geo-locations/bulk')
            .set(authHeader('ADMIN'))
            .send({ userId, geoLocationIds, ...payload });

    const geoIdsOf = ( body: { data: { rows: { geoLocationId: string }[] } } ) =>
        body.data.rows.map(( row ) => row.geoLocationId);

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        walkUserId = getTestUser('USER').userId;
        bulkUserId = getTestUser('ANALYTICS').userId;
        coverageUserId = getTestUser('ADMIN').userId;

        const levelResponse = await request(app)
            .post('/api/geo-level-types')
            .set(authHeader('ADMIN'))
            .send({ code: `UGEO${ suffix }`, name: `UserGeo ${ suffix }`, sortOrder: 1 });

        expect(levelResponse.status).toBe(201);
        geoLevelTypeId = levelResponse.body.data.geoLevelTypeId;

        originGeoId = await createGeoLocation('origen', 1);
        targetGeoId = await createGeoLocation('destino', 1);
        spareGeoId = await createGeoLocation('reserva', 1);

        // The tree of the coverage criterion: 1 province + 2 cantons + 4 parishes = 7 nodes
        provinceId = await createGeoLocation('provincia', 1);
        cantonAId = await createGeoLocation('cantonA', 2, provinceId);
        const cantonBId = await createGeoLocation('cantonB', 2, provinceId);
        parishA1Id = await createGeoLocation('parroquiaA1', 3, cantonAId);
        await createGeoLocation('parroquiaA2', 3, cantonAId);
        await createGeoLocation('parroquiaB1', 3, cantonBId);
        await createGeoLocation('parroquiaB2', 3, cantonBId);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('ESAVI-USERGEO-001 - create', () => {

        it('creates a new pair with 201 and an open-ended validity', async () => {
            const response = await assign(walkUserId, originGeoId);

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.validTo).toBeNull();
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-USERGEO-001');

            assignmentId = response.body.data.userGeoLocationId;
        });

        it('defaults validFrom to now when the payload omits it', async () => {
            const row = await AppUserGeoLocation.findByPk(assignmentId);

            expect(row?.validFrom).toBeInstanceOf(Date);
            expect(new Date(row!.validFrom).getTime()).toBeLessThanOrEqual(Date.now());
        });

        it('takes assignedByUserId from the token and ignores the body', async () => {
            const response = await assign(walkUserId, spareGeoId, { assignedByUserId: walkUserId });

            expect(response.status).toBe(201);
            expect(response.body.data.assignedByUserId).toBe(getTestUser('ADMIN').userId);
        });

        it('answers 409, not 500, when the pair is already active', async () => {
            const response = await assign(walkUserId, originGeoId);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_001_ASSIGNMENT_EXISTS');
        });

        it('rejects a validTo that is not later than validFrom with 409', async () => {
            const response = await assign(walkUserId, targetGeoId, {
                validFrom: '2030-01-01T00:00:00.000Z',
                validTo: '2029-01-01T00:00:00.000Z'
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_001_INVALID_DATE_RANGE');
        });

        it('answers 404 for an unknown user and for an unknown geoLocation', async () => {
            const noUser = await assign(ghostId, originGeoId);
            expect(noUser.status).toBe(404);
            expect(noUser.body.code).toBe('USERGEO_001_USER_NOT_FOUND');

            const noGeo = await assign(walkUserId, ghostId);
            expect(noGeo.status).toBe(404);
            expect(noGeo.body.code).toBe('USERGEO_001_GEOLOC_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-003 - get by id', () => {

        it('returns user and geoLocation with the PII decrypted', async () => {
            const response = await request(app)
                .get(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.user.email).toBe(getTestUser('USER').email);
            expect(response.body.data.user).toHaveProperty('username');
            expect(response.body.data.user).toHaveProperty('firstName');
            expect(response.body.data.user).toHaveProperty('lastName');
            expect(response.body.data.geoLocation.geoLocationId).toBe(originGeoId);
            expect(response.body.data.geoLocation).toHaveProperty('level');
            expect(response.body.data.geoLocation).toHaveProperty('parentGeoLocationId');
            // assignedBy is returned raw, without a third JOIN to appUser
            expect(response.body.data).toHaveProperty('assignedByUserId');
            expect(response.body.data.geoLocation).not.toHaveProperty('geoPolygon');
        });

        it('answers 404 for an unknown id', async () => {
            const response = await request(app)
                .get(`/api/user-geo-locations/${ ghostId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USERGEO_003_NOT_FOUND');
        });

        it('does not capture the literal paths as an :id', async () => {
            const literals = await Promise.all([
                request(app).get(`/api/user-geo-locations/user/${ walkUserId }`).set(authHeader('USER')),
                request(app).get(`/api/user-geo-locations/admin/user/${ walkUserId }`).set(authHeader('ADMIN')),
                request(app).get(`/api/user-geo-locations/user/${ walkUserId }/coverage`).set(authHeader('USER'))
            ]);

            for( const response of literals ) {
                expect(response.status).toBe(200);
            }
        });

    });

    describe('ESAVI-USERGEO-002A / 002B - listings', () => {

        let expiredGeoId: string;

        beforeAll(async () => {
            expiredGeoId = await createGeoLocation('vencida', 1);
            await assign(walkUserId, expiredGeoId);
            // Active but expired. Written by SQL because the create endpoint validates the range
            await AppUserGeoLocation.update(
                { validFrom: new Date('2020-01-01'), validTo: new Date('2021-01-01') },
                { where: { userId: walkUserId, geoLocationId: expiredGeoId } }
            );
        });

        it('returns { count, user, rows } with the user resolved once', async () => {
            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ walkUserId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(Object.keys(response.body.data).sort()).toEqual(['count', 'rows', 'user']);
            expect(response.body.data.user.email).toBe(getTestUser('USER').email);

            for( const row of response.body.data.rows ) {
                expect(row).not.toHaveProperty('user');
            }
        });

        it('hides expired assignments by default and shows them with ?current=false', async () => {
            const byDefault = await request(app)
                .get(`/api/user-geo-locations/user/${ walkUserId }`)
                .set(authHeader('USER'));
            expect(geoIdsOf(byDefault.body)).not.toContain(expiredGeoId);

            const withExpired = await request(app)
                .get(`/api/user-geo-locations/user/${ walkUserId }?current=false`)
                .set(authHeader('USER'));
            expect(geoIdsOf(withExpired.body)).toContain(expiredGeoId);
        });

        it('orders by validFrom DESC', async () => {
            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ walkUserId }?current=false`)
                .set(authHeader('USER'));

            const times = response.body.data.rows.map(( row: { validFrom: string } ) => new Date(row.validFrom).getTime());
            expect([...times].sort(( a: number, b: number ) => b - a)).toEqual(times);
        });

        it('the admin listing includes closed assignments and rejects a USER with 403', async () => {
            const closedGeoId = await createGeoLocation('cerradaListado', 1);
            const created = await assign(walkUserId, closedGeoId);
            await request(app)
                .delete(`/api/user-geo-locations/${ created.body.data.userGeoLocationId }`)
                .set(authHeader('ADMIN'));

            const publicList = await request(app)
                .get(`/api/user-geo-locations/user/${ walkUserId }?current=false`)
                .set(authHeader('USER'));
            expect(geoIdsOf(publicList.body)).not.toContain(closedGeoId);

            const adminList = await request(app)
                .get(`/api/user-geo-locations/admin/user/${ walkUserId }`)
                .set(authHeader('ADMIN'));
            expect(geoIdsOf(adminList.body)).toContain(closedGeoId);

            const forbidden = await request(app)
                .get(`/api/user-geo-locations/admin/user/${ walkUserId }`)
                .set(authHeader('USER'));
            expect(forbidden.status).toBe(403);
        });

        it('answers 404 with the code of each operation when the user does not exist', async () => {
            const publicList = await request(app)
                .get(`/api/user-geo-locations/user/${ ghostId }`)
                .set(authHeader('USER'));
            expect(publicList.status).toBe(404);
            expect(publicList.body.code).toBe('USERGEO_002A_USER_NOT_FOUND');

            const adminList = await request(app)
                .get(`/api/user-geo-locations/admin/user/${ ghostId }`)
                .set(authHeader('ADMIN'));
            expect(adminList.status).toBe(404);
            expect(adminList.body.code).toBe('USERGEO_002B_USER_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-004 - update validity', () => {

        it('updates validTo and keeps the audit history', async () => {
            const before = await AppUserGeoLocation.findByPk(assignmentId);
            const detailsBefore = ( before?.appDetails as unknown[] ).length;

            const response = await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ validTo: '2035-01-01T00:00:00.000Z' });

            expect(response.status).toBe(200);
            expect(new Date(response.body.data.validTo).toISOString()).toBe('2035-01-01T00:00:00.000Z');
            expect(response.body.data.appDetails).toHaveLength(detailsBefore + 1);
            expect(response.body.data.appDetails.at(-1).method).toBe('ESAVI-USERGEO-004');
        });

        it('accepts an explicit null to reopen the validity', async () => {
            const response = await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ validTo: null });

            expect(response.status).toBe(200);
            expect(response.body.data.validTo).toBeNull();
        });

        it('rejects userId and geoLocationId in the body with 400', async () => {
            const withUser = await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ userId: bulkUserId });
            expect(withUser.status).toBe(400);

            const withGeo = await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: targetGeoId });
            expect(withGeo.status).toBe(400);
        });

        it('validates the range against the resulting row, not only the payload', async () => {
            await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ validTo: '2035-01-01T00:00:00.000Z' });

            // only validFrom travels, and it lands after the stored validTo
            const response = await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ validFrom: '2036-01-01T00:00:00.000Z' });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_004_INVALID_DATE_RANGE');

            await request(app)
                .put(`/api/user-geo-locations/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ validTo: null });
        });

        it('answers 404 for an unknown id', async () => {
            const response = await request(app)
                .put(`/api/user-geo-locations/${ ghostId }`)
                .set(authHeader('ADMIN'))
                .send({ validTo: '2035-01-01T00:00:00.000Z' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USERGEO_004_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-006 - reassign', () => {

        it('moves the user, closes the source with validTo and returns the target', async () => {
            const response = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: targetGeoId });

            expect(response.status).toBe(200);
            expect(response.body.data.geoLocationId).toBe(targetGeoId);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.appDetails.at(-1).method).toBe('ESAVI-USERGEO-006');

            const source = await AppUserGeoLocation.findByPk(assignmentId);
            expect(source?.isActive).toBe(false);
            expect(source?.deletedAt).toBeInstanceOf(Date);
            expect(source?.validTo).toBeInstanceOf(Date);
        });

        it('rejects the same geoLocation with 409', async () => {
            const current = await AppUserGeoLocation.findOne({
                where: { userId: walkUserId, geoLocationId: targetGeoId }
            });

            const response = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ current!.userGeoLocationId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: targetGeoId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_006_SAME_GEOLOCATION');
        });

        it('rolls back when the target pair is already active, leaving the source open', async () => {
            const current = await AppUserGeoLocation.findOne({
                where: { userId: walkUserId, geoLocationId: targetGeoId }
            });

            // spareGeoId is already assigned and active for this user
            const response = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ current!.userGeoLocationId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: spareGeoId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_006_ASSIGNMENT_EXISTS');

            const source = await AppUserGeoLocation.findByPk(current!.userGeoLocationId);
            expect(source?.isActive).toBe(true);
            expect(source?.validTo).toBeNull();
            expect(source?.deletedAt).toBeNull();
        });

        it('refuses to reassign from a closed assignment with 409', async () => {
            // assignmentId was closed by the successful reassignment above
            const response = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ assignmentId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: originGeoId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_006_ALREADY_INACTIVE');
        });

        it('answers 404 for an unknown assignment and for an unknown geoLocation', async () => {
            const noAssignment = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ ghostId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: targetGeoId });
            expect(noAssignment.status).toBe(404);
            expect(noAssignment.body.code).toBe('USERGEO_006_NOT_FOUND');

            const current = await AppUserGeoLocation.findOne({
                where: { userId: walkUserId, geoLocationId: targetGeoId }
            });
            const noGeo = await request(app)
                .patch(`/api/user-geo-locations/reassign/${ current!.userGeoLocationId }`)
                .set(authHeader('ADMIN'))
                .send({ geoLocationId: ghostId });
            expect(noGeo.status).toBe(404);
            expect(noGeo.body.code).toBe('USERGEO_006_GEOLOC_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-005A / 005B - close and reopen', () => {

        let closeId: string;

        beforeAll(async () => {
            const current = await AppUserGeoLocation.findOne({
                where: { userId: walkUserId, geoLocationId: targetGeoId }
            });
            closeId = current!.userGeoLocationId;
        });

        it('closes isActive, deletedAt and validTo at once, and answers without data', async () => {
            const response = await request(app)
                .delete(`/api/user-geo-locations/${ closeId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');
            expect(Object.keys(response.body).sort()).toEqual(['message', 'ok']);

            const row = await AppUserGeoLocation.findByPk(closeId);
            expect(row?.isActive).toBe(false);
            expect(row?.deletedAt).toBeInstanceOf(Date);
            expect(row?.validTo).toBeInstanceOf(Date);
            expect(( row?.appDetails as { method: string }[] ).at(-1)?.method).toBe('ESAVI-USERGEO-005A');
        });

        it('answers 409 on a second close', async () => {
            const response = await request(app)
                .delete(`/api/user-geo-locations/${ closeId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_005A_ALREADY_INACTIVE');
        });

        it('hides the closed assignment from getById unless the caller is SUPERADMIN', async () => {
            const asAdmin = await request(app)
                .get(`/api/user-geo-locations/${ closeId }`)
                .set(authHeader('ADMIN'));
            expect(asAdmin.status).toBe(404);

            const asSuperAdmin = await request(app)
                .get(`/api/user-geo-locations/${ closeId }`)
                .set(authHeader('SUPERADMIN'));
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.isActive).toBe(false);
        });

        it('reopens the three fields and answers without data', async () => {
            const response = await request(app)
                .patch(`/api/user-geo-locations/activate/${ closeId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppUserGeoLocation.findByPk(closeId);
            expect(row?.isActive).toBe(true);
            expect(row?.deletedAt).toBeNull();
            expect(row?.validTo).toBeNull();
            // the code is stored bare, never with an _ACTIVATION suffix
            expect(( row?.appDetails as { method: string }[] ).at(-1)?.method).toBe('ESAVI-USERGEO-005B');
        });

        it('answers 409 on a second reopen', async () => {
            const response = await request(app)
                .patch(`/api/user-geo-locations/activate/${ closeId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_005B_ALREADY_ACTIVE');
        });

        it('refuses to reopen a pair whose twin is already active', async () => {
            const twinGeoId = await createGeoLocation('gemela', 1);
            const created = await assign(walkUserId, twinGeoId);
            const twinId = created.body.data.userGeoLocationId;

            await request(app).delete(`/api/user-geo-locations/${ twinId }`).set(authHeader('ADMIN'));

            // a second active row for the same pair, only reachable through direct SQL
            const intruder = await AppUserGeoLocation.create({
                userId: walkUserId,
                geoLocationId: twinGeoId,
                validFrom: new Date(),
                isActive: true
            });

            const response = await request(app)
                .patch(`/api/user-geo-locations/activate/${ twinId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_005B_ASSIGNMENT_EXISTS');

            const row = await AppUserGeoLocation.findByPk(twinId);
            expect(row?.isActive).toBe(false);

            // the intruder would break the invariant checked at the end of this file
            await intruder.destroy({ force: true });
        });

    });

    describe('ESAVI-USERGEO-005C - purge', () => {

        let purgeId: string;

        beforeAll(async () => {
            const purgeGeoId = await createGeoLocation('purgable', 1);
            const created = await assign(walkUserId, purgeGeoId);
            purgeId = created.body.data.userGeoLocationId;
        });

        it('refuses to purge a row that is still active', async () => {
            const response = await request(app)
                .delete(`/api/user-geo-locations/purge/${ purgeId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_005C_STILL_ACTIVE');

            // the row survives the refusal
            expect(await AppUserGeoLocation.findByPk(purgeId)).not.toBeNull();
        });

        it('is closed to ADMIN', async () => {
            const response = await request(app)
                .delete(`/api/user-geo-locations/purge/${ purgeId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(403);
        });

        it('destroys the row once it has been closed, and answers without data', async () => {
            await request(app)
                .delete(`/api/user-geo-locations/${ purgeId }`)
                .set(authHeader('ADMIN'));

            const response = await request(app)
                .delete(`/api/user-geo-locations/purge/${ purgeId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');
            expect(Object.keys(response.body).sort()).toEqual(['message', 'ok']);

            // gone for good: paranoid false, so this is not a soft-delete filter talking
            expect(await AppUserGeoLocation.findByPk(purgeId, { paranoid: false })).toBeNull();
        });

        it('answers 404 once the row no longer exists', async () => {
            const response = await request(app)
                .delete(`/api/user-geo-locations/purge/${ purgeId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USERGEO_005C_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-001 - create over a closed pair', () => {

        it('reactivates with 200 instead of inserting a second row', async () => {
            const reopenGeoId = await createGeoLocation('reactivable', 1);
            const created = await assign(walkUserId, reopenGeoId);
            const originalId = created.body.data.userGeoLocationId;

            await request(app).delete(`/api/user-geo-locations/${ originalId }`).set(authHeader('ADMIN'));

            const response = await assign(walkUserId, reopenGeoId);

            expect(response.status).toBe(200);
            expect(response.body.data.userGeoLocationId).toBe(originalId);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.validTo).toBeNull();
            expect(response.body.data.deletedAt).toBeNull();
            expect(response.body.data.appDetails.at(-1).detail).toBe('Assignment reactivated by create');

            const rows = await AppUserGeoLocation.count({
                where: { userId: walkUserId, geoLocationId: reopenGeoId }
            });
            expect(rows).toBe(1);
        });

    });

    describe('ESAVI-USERGEO-007 - bulk assign', () => {

        it('assigns three geoLocations with 201 and count 3', async () => {
            const ids = [
                await createGeoLocation('lote1', 1),
                await createGeoLocation('lote2', 1),
                await createGeoLocation('lote3', 1)
            ];

            const response = await bulkAssign(bulkUserId, ids);

            expect(response.status).toBe(201);
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows).toHaveLength(3);
            for( const row of response.body.data.rows ) {
                expect(row.isActive).toBe(true);
                expect(row.appDetails.at(-1).method).toBe('ESAVI-USERGEO-007');
            }
        });

        it('rolls back the whole batch when one geoLocation does not exist', async () => {
            const ids = [await createGeoLocation('loteFallido1', 1), await createGeoLocation('loteFallido2', 1)];

            const response = await bulkAssign(bulkUserId, [...ids, ghostId]);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USERGEO_007_GEOLOC_NOT_FOUND');
            expect(response.body.message).toContain('1');

            const created = await AppUserGeoLocation.count({
                where: { userId: bulkUserId, geoLocationId: ids }
            });
            expect(created).toBe(0);
        });

        it('rolls back the whole batch when one pair is already active', async () => {
            const taken = await createGeoLocation('loteTomada', 1);
            const fresh = [await createGeoLocation('loteNueva1', 1), await createGeoLocation('loteNueva2', 1)];

            expect(( await bulkAssign(bulkUserId, [taken]) ).status).toBe(201);

            const response = await bulkAssign(bulkUserId, [taken, ...fresh]);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USERGEO_007_ASSIGNMENT_EXISTS');

            const created = await AppUserGeoLocation.count({
                where: { userId: bulkUserId, geoLocationId: fresh }
            });
            expect(created).toBe(0);
        });

        it('mixes new and closed pairs, leaving them all active without duplicates', async () => {
            const reused = await createGeoLocation('loteReusada', 1);
            const fresh = await createGeoLocation('loteFresca', 1);

            const seed = await bulkAssign(bulkUserId, [reused]);
            const reusedId = seed.body.data.rows[0].userGeoLocationId;
            await request(app).delete(`/api/user-geo-locations/${ reusedId }`).set(authHeader('ADMIN'));

            const response = await bulkAssign(bulkUserId, [reused, fresh]);

            expect(response.status).toBe(201);
            expect(response.body.data.count).toBe(2);

            const reactivated = response.body.data.rows
                .find(( row: { geoLocationId: string } ) => row.geoLocationId === reused);
            expect(reactivated.userGeoLocationId).toBe(reusedId);
            expect(reactivated.validTo).toBeNull();

            const rows = await AppUserGeoLocation.count({
                where: { userId: bulkUserId, geoLocationId: reused }
            });
            expect(rows).toBe(1);
        });

        it('rejects an empty array and repeated UUIDs with 400', async () => {
            const geoId = await createGeoLocation('loteValidador', 1);

            expect(( await bulkAssign(bulkUserId, []) ).status).toBe(400);
            expect(( await bulkAssign(bulkUserId, [geoId, geoId]) ).status).toBe(400);
        });

        it('answers 409 for an invalid range and 404 for an unknown user', async () => {
            const geoId = await createGeoLocation('loteRango', 1);

            const badRange = await bulkAssign(bulkUserId, [geoId], {
                validFrom: '2030-01-01T00:00:00.000Z',
                validTo: '2029-01-01T00:00:00.000Z'
            });
            expect(badRange.status).toBe(409);
            expect(badRange.body.code).toBe('USERGEO_007_INVALID_DATE_RANGE');

            const noUser = await bulkAssign(ghostId, [geoId]);
            expect(noUser.status).toBe(404);
            expect(noUser.body.code).toBe('USERGEO_007_USER_NOT_FOUND');
        });

    });

    describe('ESAVI-USERGEO-008 - effective coverage', () => {

        it('expands a province into its two cantons and four parishes', async () => {
            expect(( await assign(coverageUserId, provinceId) ).status).toBe(201);

            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ coverageUserId }/coverage`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(7);
            expect(response.body.data.coverage).toHaveLength(7);
            expect(response.body.data.assigned).toHaveLength(1);
            expect(response.body.data.assigned[0].geoLocationId).toBe(provinceId);

            // coverage includes the assigned node itself
            const ids = response.body.data.coverage.map(( row: { geoLocationId: string } ) => row.geoLocationId);
            expect(ids).toContain(provinceId);
            expect(ids).toContain(parishA1Id);

            expect(Object.keys(response.body.data.assigned[0]).sort())
                .toEqual(['geoLocationId', 'level', 'name']);
            expect(Object.keys(response.body.data.coverage[0]).sort())
                .toEqual(['geoLocationId', 'level', 'name', 'parentGeoLocationId']);
        });

        it('never writes appDetails', async () => {
            const before = await AppUserGeoLocation.findOne({
                where: { userId: coverageUserId, geoLocationId: provinceId }
            });
            const snapshot = JSON.stringify(before?.appDetails);

            await request(app)
                .get(`/api/user-geo-locations/user/${ coverageUserId }/coverage`)
                .set(authHeader('USER'));

            const after = await AppUserGeoLocation.findOne({
                where: { userId: coverageUserId, geoLocationId: provinceId }
            });
            expect(JSON.stringify(after?.appDetails)).toBe(snapshot);
        });

        it('leaves an inactive geoLocation and its branch out of the coverage', async () => {
            await GeoLocation.update({ isActive: false }, { where: { geoLocationId: cantonAId } });

            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ coverageUserId }/coverage`)
                .set(authHeader('USER'));

            const ids = response.body.data.coverage.map(( row: { geoLocationId: string } ) => row.geoLocationId);
            expect(ids).not.toContain(cantonAId);
            // the descent stops there, so its parishes disappear too
            expect(ids).not.toContain(parishA1Id);
            expect(response.body.data.count).toBe(4);

            await GeoLocation.update({ isActive: true }, { where: { geoLocationId: cantonAId } });
        });

        it('does not count nodes from an expired assignment', async () => {
            await AppUserGeoLocation.update(
                { validFrom: new Date('2020-01-01'), validTo: new Date('2021-01-01') },
                { where: { userId: coverageUserId, geoLocationId: provinceId } }
            );

            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ coverageUserId }/coverage`)
                .set(authHeader('USER'));

            expect(response.body.data.count).toBe(0);
            expect(response.body.data.assigned).toHaveLength(0);

            await AppUserGeoLocation.update(
                { validFrom: new Date(), validTo: null },
                { where: { userId: coverageUserId, geoLocationId: provinceId } }
            );
        });

        it('does not repeat nodes when a parent and its child are both assigned', async () => {
            expect(( await assign(coverageUserId, cantonAId) ).status).toBe(201);

            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ coverageUserId }/coverage`)
                .set(authHeader('USER'));

            const ids = response.body.data.coverage.map(( row: { geoLocationId: string } ) => row.geoLocationId);
            expect(new Set(ids).size).toBe(ids.length);
            expect(response.body.data.count).toBe(7);
            expect(response.body.data.assigned).toHaveLength(2);
        });

        it('answers 404 for an unknown user', async () => {
            const response = await request(app)
                .get(`/api/user-geo-locations/user/${ ghostId }/coverage`)
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USERGEO_008_USER_NOT_FOUND');
        });

    });

    describe('the pair invariant', () => {

        it('never leaves two rows for the same (userId, geoLocationId)', async () => {
            const [duplicates] = await sequelize.query(
                `SELECT "userId", "geoLocationId", count(*) AS total
                 FROM "appUserGeoLocation"
                 GROUP BY "userId", "geoLocationId"
                 HAVING count(*) > 1`
            );

            expect(duplicates).toEqual([]);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const differentialGeoId = await createGeoLocation('differential', 1);
            const created = await assign(walkUserId, differentialGeoId, { validTo: '2035-01-01T00:00:00.000Z' });
            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/user-geo-locations',
                id: created.body.data.userGeoLocationId,
                model: AppUserGeoLocation,
                // Moving an assignment is ESAVI-USERGEO-006, so the update validator rejects
                // both keys with a 400
                strip: ['userId', 'geoLocationId']
            });
        });

    });

});

