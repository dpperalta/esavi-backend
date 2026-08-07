import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { AppRole, AppUserRole } from '../../src/models';
import { ROLES } from '../../src/constants/roles.constants';
import { jwtGenerate } from '../../src/helpers/jwt.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader, getTestUser, TEST_PASSWORD } from '../setup/auth';

/**
 * Contract suite for the eight appUserRole operations of SPEC F02. It walks the entity
 * end to end and pins the five rules that no other suite can check:
 *
 *  - the one-row-per-(userId, roleId) invariant, stricter than the partial unique index
 *    of the DDL, which turns a would-be 23505/500 into a 409 and a reactivation into a 200;
 *  - the escalation guard, the first 403 in this repository raised by a service instead
 *    of by validateUserRole;
 *  - the last-SUPERADMIN guard, without which 005B would be unreachable forever;
 *  - the all-or-nothing semantics of 007, verified through its three rollbacks;
 *  - that revoking actually revokes: an already-issued token stops authorizing.
 *
 * Every scenario that changes a user's level uses a throwaway user created for this file.
 * The four seeded test users are never elevated: their tokens are shared with the rest of
 * the run, and rows survive from one suite file to the next.
 */
describe('appUserRole contract', () => {

    const suffix = Date.now().toString(36);
    const ghostId = '11111111-1111-4111-8111-111111111111';

    let superAdminRoleId: string;
    let adminRoleId: string;
    let userRoleId: string;
    let analyticsRoleId: string;

    // Throwaway users, one per scenario, so no two scenarios fight over the same pairs
    let walkUserId: string;
    let bulkUserId: string;
    let spareSuperUserId: string;
    let revokedUserId: string;
    let revokedUserToken: string;

    let assignmentId: string;

    // errorHandler logs every error it handles, and a good half of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const roleIdOf = async ( code: string ): Promise<string> => {
        const role = await AppRole.findOne({ where: { code } });

        if( !role ) {
            throw new Error(`The role "${ code }" is not seeded. tests/setup/database.ts must run first.`);
        }

        return role.getDataValue('roleId');
    };

    const createUser = async ( label: string, roleId: string ): Promise<string> => {
        const response = await request(app)
            .post('/api/users')
            .set(authHeader('SUPERADMIN'))
            .send({
                email: `${ label }.${ suffix }@test.local`,
                password: TEST_PASSWORD,
                firstName: 'Test',
                lastName: label,
                roleId
            });

        expect(response.status).toBe(201);

        return response.body.data.userId;
    };

    const assign = ( userId: string, roleId: string, payload: Record<string, unknown> = {} ) =>
        request(app)
            .post('/api/user-roles')
            .set(authHeader('ADMIN'))
            .send({ userId, roleId, ...payload });

    const bulkAssign = ( userId: string, roleIds: unknown ) =>
        request(app)
            .post('/api/user-roles/bulk')
            .set(authHeader('ADMIN'))
            .send({ userId, roleIds });

    const activeAssignmentCount = ( userId: string ) =>
        AppUserRole.count({ where: { userId, isActive: true } });

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        superAdminRoleId = await roleIdOf(ROLES.SUPERADMIN);
        adminRoleId = await roleIdOf(ROLES.ADMIN);
        userRoleId = await roleIdOf(ROLES.USER);
        analyticsRoleId = await roleIdOf(ROLES.ANALYTICS);

        walkUserId = await createUser('walk', userRoleId);
        bulkUserId = await createUser('bulk', userRoleId);
        spareSuperUserId = await createUser('spare', userRoleId);

        // This one needs a token of its own: the point is to reuse it after its role is revoked
        revokedUserId = await createUser('revoked', adminRoleId);
        revokedUserToken = await jwtGenerate({ userId: revokedUserId }) as string;
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('ESAVI-USERROLE-001 - assign', () => {

        it('assigns a new pair with 201 and leaves validTo untouched', async () => {
            const response = await assign(walkUserId, analyticsRoleId);

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.validTo).toBeNull();
            expect(response.body.data.validFrom).not.toBeNull();
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-USERROLE-001');

            assignmentId = response.body.data.userRoleId;
        });

        it('takes assignedByUserId from the token and ignores the body', async () => {
            const assignment = await AppUserRole.findByPk(assignmentId);

            expect(assignment?.getDataValue('assignedByUserId')).toBe(getTestUser('ADMIN').userId);
        });

        it('rejects the same pair while it is active with 409', async () => {
            const response = await assign(walkUserId, analyticsRoleId);

            expect(response.status).toBe(409);
        });

        it('rejects a role above the requester level with 403', async () => {
            const response = await assign(walkUserId, superAdminRoleId);

            expect(response.status).toBe(403);
        });

        it('allows a role of the same level as the requester', async () => {
            const response = await assign(walkUserId, adminRoleId);

            expect(response.status).toBe(201);
        });

        it('allows assigning oneself a role of lower level', async () => {
            const response = await assign(getTestUser('ADMIN').userId, userRoleId);

            expect(response.status).toBe(201);
        });

        it('rejects an unknown user with 404', async () => {
            const response = await assign(ghostId, analyticsRoleId);

            expect(response.status).toBe(404);
        });

        it('rejects an unknown role with 404', async () => {
            const response = await assign(walkUserId, ghostId);

            expect(response.status).toBe(404);
        });

        it('rejects validFrom or validTo in the body with 400', async () => {
            const withValidTo = await assign(walkUserId, analyticsRoleId, { validTo: '2030-01-01T00:00:00.000Z' });
            const withValidFrom = await assign(walkUserId, analyticsRoleId, { validFrom: '2030-01-01T00:00:00.000Z' });

            expect(withValidTo.status).toBe(400);
            expect(withValidFrom.status).toBe(400);
        });

    });

    describe('ESAVI-USERROLE-003 - get by id', () => {

        it('returns the assignment with its user and role, and the user PII decrypted', async () => {
            const response = await request(app)
                .get(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.userRoleId).toBe(assignmentId);
            expect(response.body.data.role.code).toBe(ROLES.ANALYTICS);
            expect(response.body.data.role.level).toBeDefined();
            expect(response.body.data.user.email).toBe(`walk.${ suffix }@test.local`);
        });

        it('returns 404 for an unknown id', async () => {
            const response = await request(app)
                .get(`/api/user-roles/${ ghostId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(404);
        });

    });

    describe('ESAVI-USERROLE-002A / 002B - listings by user', () => {

        it('returns the user once and every active assignment as rows', async () => {
            const response = await request(app)
                .get(`/api/user-roles/user/${ walkUserId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.user.userId).toBe(walkUserId);
            expect(response.body.data.user.email).toBe(`walk.${ suffix }@test.local`);
            // USER at creation, plus ANALYTICS and ADMIN assigned above
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows[0].user).toBeUndefined();
            expect(response.body.data.rows[0].role).toBeDefined();
        });

        it('returns 404 for an unknown user', async () => {
            const response = await request(app)
                .get(`/api/user-roles/user/${ ghostId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
        });

    });

    describe('ESAVI-USERROLE-006 - listing by role', () => {

        it('returns the role once and its holders with their PII decrypted', async () => {
            const response = await request(app)
                .get(`/api/user-roles/role/${ analyticsRoleId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.role.code).toBe(ROLES.ANALYTICS);
            expect(response.body.data.rows.every(( row: { user?: unknown } ) => row.user !== undefined)).toBe(true);

            const holders = response.body.data.rows.map(( row: { userId: string } ) => row.userId);
            expect(holders).toContain(walkUserId);
        });

        it('returns 404 for an unknown role', async () => {
            const response = await request(app)
                .get(`/api/user-roles/role/${ ghostId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(404);
        });

    });

    describe('ESAVI-USERROLE-005A / 005B - revoke and reinstate', () => {

        it('revokes with 200, answers without data and leaves validTo null', async () => {
            const response = await request(app)
                .delete(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();

            const assignment = await AppUserRole.findByPk(assignmentId);
            expect(assignment?.getDataValue('isActive')).toBe(false);
            expect(assignment?.getDataValue('deletedAt')).not.toBeNull();
            expect(assignment?.getDataValue('validTo')).toBeNull();

            const appDetails = assignment?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-USERROLE-005A');
        });

        it('rejects a second revocation with 409', async () => {
            const response = await request(app)
                .delete(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
        });

        it('hides the revoked assignment from 002A and shows it in 002B', async () => {
            const publicList = await request(app)
                .get(`/api/user-roles/user/${ walkUserId }`)
                .set(authHeader('USER'));
            const adminList = await request(app)
                .get(`/api/user-roles/admin/user/${ walkUserId }`)
                .set(authHeader('ADMIN'));

            expect(publicList.body.data.count).toBe(2);
            expect(adminList.body.data.count).toBe(3);
        });

        it('returns 404 on a revoked assignment for ADMIN and 200 for SUPERADMIN', async () => {
            const asAdmin = await request(app)
                .get(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('ADMIN'));
            const asSuperAdmin = await request(app)
                .get(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('SUPERADMIN'));

            expect(asAdmin.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
        });

        it('reactivates the revoked pair through 001 with 200 and no second row', async () => {
            const response = await assign(walkUserId, analyticsRoleId);

            expect(response.status).toBe(200);
            expect(response.body.data.userRoleId).toBe(assignmentId);
            expect(response.body.data.deletedAt).toBeNull();
            // The history is preserved, never overwritten
            expect(response.body.data.appDetails.length).toBeGreaterThan(2);

            const rows = await AppUserRole.count({ where: { userId: walkUserId, roleId: analyticsRoleId } });
            expect(rows).toBe(1);
        });

        it('reinstates through 005B and rejects doing it twice with 409', async () => {
            await request(app)
                .delete(`/api/user-roles/${ assignmentId }`)
                .set(authHeader('ADMIN'));

            const first = await request(app)
                .patch(`/api/user-roles/activate/${ assignmentId }`)
                .set(authHeader('SUPERADMIN'));
            const second = await request(app)
                .patch(`/api/user-roles/activate/${ assignmentId }`)
                .set(authHeader('SUPERADMIN'));

            expect(first.status).toBe(200);
            expect(first.body.data).toBeUndefined();
            expect(second.status).toBe(409);

            const assignment = await AppUserRole.findByPk(assignmentId);
            expect(assignment?.getDataValue('deletedAt')).toBeNull();

            const appDetails = assignment?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-USERROLE-005B');
        });

    });

    describe('the last SUPERADMIN guard', () => {

        it('refuses to revoke the only active SUPERADMIN assignment with 409', async () => {
            const assignment = await AppUserRole.findOne({
                where: { userId: getTestUser('SUPERADMIN').userId, roleId: superAdminRoleId }
            });

            const response = await request(app)
                .delete(`/api/user-roles/${ assignment?.getDataValue('userRoleId') }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(assignment && (await assignment.reload()).getDataValue('isActive')).toBe(true);
        });

        it('allows the revocation once a second SUPERADMIN exists', async () => {
            // Only a SUPERADMIN can hand out SUPERADMIN: the escalation guard sees to that
            const assigned = await request(app)
                .post('/api/user-roles')
                .set(authHeader('SUPERADMIN'))
                .send({ userId: spareSuperUserId, roleId: superAdminRoleId });

            expect(assigned.status).toBe(201);

            const response = await request(app)
                .delete(`/api/user-roles/${ assigned.body.data.userRoleId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
        });

    });

    describe('ESAVI-USERROLE-007 - bulk assign', () => {

        it('rejects an empty array and duplicated ids with 400', async () => {
            const empty = await bulkAssign(bulkUserId, []);
            const duplicated = await bulkAssign(bulkUserId, [analyticsRoleId, analyticsRoleId]);

            expect(empty.status).toBe(400);
            expect(duplicated.status).toBe(400);
        });

        it('rolls back the whole batch when one role does not exist', async () => {
            const before = await activeAssignmentCount(bulkUserId);

            const response = await bulkAssign(bulkUserId, [analyticsRoleId, ghostId]);

            expect(response.status).toBe(404);
            expect(await activeAssignmentCount(bulkUserId)).toBe(before);
        });

        it('rolls back the whole batch when one role is above the requester level', async () => {
            const before = await activeAssignmentCount(bulkUserId);

            const response = await bulkAssign(bulkUserId, [analyticsRoleId, superAdminRoleId]);

            expect(response.status).toBe(403);
            expect(await activeAssignmentCount(bulkUserId)).toBe(before);
        });

        it('assigns the whole batch with 201', async () => {
            const response = await bulkAssign(bulkUserId, [analyticsRoleId, adminRoleId]);

            expect(response.status).toBe(201);
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.rows[0].appDetails[0].method).toBe('ESAVI-USERROLE-007');
        });

        it('rolls back the whole batch when one pair is already active', async () => {
            const before = await activeAssignmentCount(bulkUserId);

            const response = await bulkAssign(bulkUserId, [analyticsRoleId]);

            expect(response.status).toBe(409);
            expect(await activeAssignmentCount(bulkUserId)).toBe(before);
        });

    });

    describe('revocation actually revokes', () => {

        it('stops an already-issued token from authorizing once its role is revoked', async () => {
            const path = `/api/user-roles/admin/user/${ bulkUserId }`;

            const before = await request(app).get(path).set({ Authorization: `Bearer ${ revokedUserToken }` });
            expect(before.status).not.toBe(403);

            const assignment = await AppUserRole.findOne({
                where: { userId: revokedUserId, roleId: adminRoleId }
            });

            const revoked = await request(app)
                .delete(`/api/user-roles/${ assignment?.getDataValue('userRoleId') }`)
                .set(authHeader('ADMIN'));
            expect(revoked.status).toBe(200);

            // Same token, no new login: tokenValidation reloads the roles on every request
            const after = await request(app).get(path).set({ Authorization: `Bearer ${ revokedUserToken }` });
            expect(after.status).toBe(403);
        });

        it('stops authorizing when the appRole itself is deactivated', async () => {
            const spareToken = await jwtGenerate({ userId: spareSuperUserId }) as string;
            const path = `/api/user-roles/user/${ bulkUserId }`;

            const before = await request(app).get(path).set({ Authorization: `Bearer ${ spareToken }` });
            expect(before.status).not.toBe(403);

            await AppRole.update({ isActive: false }, { where: { roleId: userRoleId } });

            const after = await request(app).get(path).set({ Authorization: `Bearer ${ spareToken }` });
            expect(after.status).toBe(403);

            // Restored immediately: the seeded USER test user authorizes with this very role
            await AppRole.update({ isActive: true }, { where: { roleId: userRoleId } });
        });

    });

    describe('the invariants of the entity', () => {

        it('never leaves two rows for the same (userId, roleId) pair', async () => {
            const duplicates = await sequelize.query(
                `SELECT "userId", "roleId", count(*) FROM "appUserRole"
                 GROUP BY "userId", "roleId" HAVING count(*) > 1`,
                { type: QueryTypes.SELECT }
            );

            expect(duplicates).toHaveLength(0);
        });

        it('never writes validTo', async () => {
            const rows = await sequelize.query(
                'SELECT count(*)::int AS total FROM "appUserRole" WHERE "validTo" IS NOT NULL',
                { type: QueryTypes.SELECT }
            ) as { total: number }[];

            expect(rows[0].total).toBe(0);
        });

    });

});
