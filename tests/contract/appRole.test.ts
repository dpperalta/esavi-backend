import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { app } from '../../src/app';
import { AppRole } from '../../src/models';
import { sequelize } from '../../src/database/connection';
import { jwtGenerate } from '../../src/helpers/jwt.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader, getTestUser } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven appRole operations of SPEC F03. It walks the entity
 * end to end and covers the error paths that cannot be checked by hand reliably:
 * the two uniqueness rules, the level escalation guard on create and update, the
 * system-role guard, the three retirement guards, and — the point of the spec —
 * that a role created through the API actually authorizes.
 *
 * No cleanup: TRG_appRole_preventPhysicalDelete blocks physical deletes, and
 * globalSetup recreates the database from esaviapp.sql on every run.
 */
describe('appRole contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // errorHandler logs every error it handles, and half of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    // Fixtures shared by the whole file
    let systemRoleId: string;
    let superAdminRoleId: string;

    const createRole = async (
        role: TestRole,
        payload: Record<string, unknown>
    ) => request(app).post('/api/roles').set(authHeader(role)).send(payload);

    const createRoleFixture = async ( label: string, level: number ): Promise<string> => {
        const response = await createRole('SUPERADMIN', {
            code: `${ label }_${ suffix }`,
            name: `${ label }_${ suffix }`,
            description: `Fixture ${ label }`,
            level
        });

        expect(response.status).toBe(201);

        return response.body.data.roleId;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        // isSystemRole is never writable through the API by design, so the flag is set by SQL,
        // which is exactly how the spec says a system role comes to be
        systemRoleId = await createRoleFixture('system', 20);
        await AppRole.update({ isSystemRole: true }, { where: { roleId: systemRoleId } });

        superAdminRoleId = (await AppRole.findOne({ where: { code: 'SUPERADMIN' } }))!.getDataValue('roleId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('full lifecycle', () => {

        let roleId: string;

        // ESAVI-APPROLE-001
        it('create responds 201 with the envelope and the normalized entity', async () => {
            const response = await createRole('ADMIN', {
                code: `  lifecycle ${ suffix }  `,
                name: `lifecycle ${ suffix }`,
                description: '  Walks the whole entity  ',
                level: 45
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data.roleId).toEqual(expect.any(String));
            // name is normalized with toConstantCase, not toTitleCase: it is the key the
            // middleware and the permissions predicates compare against
            expect(response.body.data.code).toBe(`LIFECYCLE_${ suffix }`);
            expect(response.body.data.name).toBe(`LIFECYCLE_${ suffix }`);
            expect(response.body.data.description).toBe('Walks the whole entity');
            expect(response.body.data.isSystemRole).toBe(false);
            expect(response.body.data.isActive).toBe(true);

            roleId = response.body.data.roleId;
        });

        it('create writes one appDetails entry with the operation code', async () => {
            const response = await request(app).get(`/api/roles/${ roleId }`).set(authHeader('USER'));

            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0]).toEqual(
                expect.objectContaining({ method: 'ESAVI-APPROLE-001', user: getTestUser('ADMIN').userId })
            );
        });

        // ESAVI-APPROLE-003
        it('getById responds 200 with activeUserCount and without sysDetails', async () => {
            const response = await request(app).get(`/api/roles/${ roleId }`).set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.roleId).toBe(roleId);
            expect(response.body.data.activeUserCount).toBe(0);
            expect(response.body.data).not.toHaveProperty('sysDetails');
        });

        // ESAVI-APPROLE-002A
        it('list responds 200 with { count, rows } and no activeUserCount per row', async () => {
            const response = await request(app).get('/api/roles?limit=100').set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('count');
            expect(Array.isArray(response.body.data.rows)).toBe(true);

            const row = response.body.data.rows.find((entry: { roleId: string }) => entry.roleId === roleId);
            expect(row).toBeDefined();
            expect(row).not.toHaveProperty('activeUserCount');
            expect(row).not.toHaveProperty('sysDetails');
        });

        // ESAVI-APPROLE-002B
        it('admin list responds 200 and orders by level DESC then name ASC', async () => {
            const response = await request(app).get('/api/roles/admin?limit=100').set(authHeader('ADMIN'));

            expect(response.status).toBe(200);

            const rows = response.body.data.rows as { level: number, name: string }[];
            for( let index = 1; index < rows.length; index++ ) {
                const previous = rows[index - 1];
                const current = rows[index];
                expect(previous.level).toBeGreaterThanOrEqual(current.level);
                if( previous.level === current.level ) {
                    expect(previous.name.localeCompare(current.name)).toBeLessThanOrEqual(0);
                }
            }
        });

        // ESAVI-APPROLE-004
        it('update responds 200, normalizes and preserves the appDetails history', async () => {
            const response = await request(app)
                .put(`/api/roles/${ roleId }`)
                .set(authHeader('ADMIN'))
                .send({ name: `renamed ${ suffix }`, description: 'Renamed', level: 50 });

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe(`RENAMED_${ suffix }`);
            expect(response.body.data.level).toBe(50);
            expect(response.body.data).not.toHaveProperty('sysDetails');

            const appDetails = response.body.data.appDetails as { method: string }[];
            expect(appDetails).toHaveLength(2);
            expect(appDetails[0].method).toBe('ESAVI-APPROLE-001');
            expect(appDetails[1].method).toBe('ESAVI-APPROLE-004');
        });

        it('a no-op update responds 200 without appending an audit entry', async () => {
            const response = await request(app)
                .put(`/api/roles/${ roleId }`)
                .set(authHeader('ADMIN'))
                .send({});

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe(`RENAMED_${ suffix }`);
            // An update that touched nothing is not a change: appDetails counts changes, not
            // attempts, and stays on the two entries the create and the real update left
            expect(response.body.data.appDetails).toHaveLength(2);
        });

        // ESAVI-APPROLE-005A
        it('delete responds 200 without data and seals deletedAt', async () => {
            const response = await request(app).delete(`/api/roles/${ roleId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppRole.findByPk(roleId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();
        });

        it('a retired role disappears from the public list and from getById', async () => {
            const list = await request(app).get('/api/roles?limit=100').set(authHeader('USER'));
            expect(list.body.data.rows.map((row: { roleId: string }) => row.roleId)).not.toContain(roleId);

            expect((await request(app).get(`/api/roles/${ roleId }`).set(authHeader('ADMIN'))).status).toBe(404);
            // canViewInactive is SUPERADMIN only
            expect((await request(app).get(`/api/roles/${ roleId }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
        });

        it('a retired role still shows in the admin list', async () => {
            const response = await request(app).get('/api/roles/admin?limit=100').set(authHeader('ADMIN'));
            expect(response.body.data.rows.map((row: { roleId: string }) => row.roleId)).toContain(roleId);
        });

        it('a second delete responds 409 ALREADY_INACTIVE', async () => {
            const response = await request(app).delete(`/api/roles/${ roleId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_005A_ALREADY_INACTIVE');
        });

        // ESAVI-APPROLE-005B
        it('activate responds 200 without data and clears deletedAt', async () => {
            const response = await request(app)
                .patch(`/api/roles/activate/${ roleId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppRole.findByPk(roleId);
            expect(row!.getDataValue('isActive')).toBe(true);
            expect(row!.getDataValue('deletedAt')).toBeNull();
        });

        it('a second activate responds 409 ALREADY_ACTIVE', async () => {
            const response = await request(app)
                .patch(`/api/roles/activate/${ roleId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_005B_ALREADY_ACTIVE');
        });

        it('appDetails.method carries the bare operation code, with no _ACTIVATION suffix', async () => {
            const row = await AppRole.findByPk(roleId);
            const methods = (row!.getDataValue('appDetails') as { method: string }[]).map(entry => entry.method);

            expect(methods).toContain('ESAVI-APPROLE-005A');
            expect(methods).toContain('ESAVI-APPROLE-005B');
            for( const method of methods ) {
                expect(method).not.toMatch(/_ACTIVATION|_DEACTIVATION/);
            }
        });

    });

    describe('uniqueness', () => {

        let occupantCode: string;
        let occupantName: string;
        let occupantId: string;

        beforeAll(async () => {
            occupantId = await createRoleFixture('occupant', 30);
            const occupant = await AppRole.findByPk(occupantId);
            occupantCode = occupant!.getDataValue('code');
            occupantName = occupant!.getDataValue('name');
        });

        it('rejects a duplicated code with 409, not a 500 from UQ_appRole_code', async () => {
            const response = await createRole('ADMIN', {
                code: occupantCode,
                name: `free_name_${ suffix }`,
                description: 'x',
                level: 10
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_001_CODE_EXISTS');
        });

        it('rejects a duplicated name with 409 even when the code is free', async () => {
            const response = await createRole('ADMIN', {
                code: `free_code_${ suffix }`,
                name: occupantName,
                description: 'x',
                level: 10
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_001_NAME_EXISTS');
        });

        it('keeps a retired role\'s code taken: uniqueness does not filter by isActive', async () => {
            const retiredId = await createRoleFixture('retired_code', 15);
            const retiredCode = (await AppRole.findByPk(retiredId))!.getDataValue('code');

            expect((await request(app).delete(`/api/roles/${ retiredId }`).set(authHeader('ADMIN'))).status).toBe(200);

            const response = await createRole('ADMIN', {
                code: retiredCode,
                name: `after_retirement_${ suffix }`,
                description: 'x',
                level: 10
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_001_CODE_EXISTS');
        });

        it('rejects on update a code that belongs to another role', async () => {
            const otherId = await createRoleFixture('other_code', 12);

            const response = await request(app)
                .put(`/api/roles/${ otherId }`)
                .set(authHeader('ADMIN'))
                .send({ code: occupantCode });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_004_CODE_EXISTS');
        });

        it('rejects on update a name that belongs to another role', async () => {
            const otherId = await createRoleFixture('other_name', 11);

            const response = await request(app)
                .put(`/api/roles/${ otherId }`)
                .set(authHeader('ADMIN'))
                .send({ name: occupantName });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_004_NAME_EXISTS');
        });

        it('leaves no two roles sharing a name', async () => {
            const rows = await sequelize.query(
                'SELECT "name" FROM "appRole" GROUP BY "name" HAVING count(*) > 1',
                { type: QueryTypes.SELECT }
            );

            expect(rows).toHaveLength(0);
        });

    });

    describe('level escalation', () => {

        it('rejects an ADMIN creating a role above its own level', async () => {
            const response = await createRole('ADMIN', {
                code: `escalate_${ suffix }`,
                name: `escalate_${ suffix }`,
                description: 'x',
                level: 100
            });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('APPROLE_001_LEVEL_EXCEEDED');
        });

        it('allows an ADMIN to create a role at its own level', async () => {
            const response = await createRole('ADMIN', {
                code: `equal_level_${ suffix }`,
                name: `equal_level_${ suffix }`,
                description: 'x',
                level: 50
            });

            expect(response.status).toBe(201);
        });

        it('rejects an ADMIN raising an existing role above its own level', async () => {
            const targetId = await createRoleFixture('raise_me', 10);

            const response = await request(app)
                .put(`/api/roles/${ targetId }`)
                .set(authHeader('ADMIN'))
                .send({ level: 90 });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('APPROLE_004_LEVEL_EXCEEDED');
        });

        it('lets a SUPERADMIN create and edit roles at any level', async () => {
            const created = await createRole('SUPERADMIN', {
                code: `top_level_${ suffix }`,
                name: `top_level_${ suffix }`,
                description: 'x',
                level: 100
            });

            expect(created.status).toBe(201);

            const updated = await request(app)
                .put(`/api/roles/${ created.body.data.roleId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ level: 99 });

            expect(updated.status).toBe(200);
        });

    });

    describe('system roles', () => {

        it('rejects an ADMIN editing a system role and allows a SUPERADMIN', async () => {
            const asAdmin = await request(app)
                .put(`/api/roles/${ systemRoleId }`)
                .set(authHeader('ADMIN'))
                .send({ description: 'Edited by admin' });

            expect(asAdmin.status).toBe(403);
            expect(asAdmin.body.code).toBe('APPROLE_004_SYSTEM_ROLE');

            const asSuperAdmin = await request(app)
                .put(`/api/roles/${ systemRoleId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ description: 'Edited by superadmin' });

            expect(asSuperAdmin.status).toBe(200);
        });

        it('rejects an ADMIN retiring a system role', async () => {
            const response = await request(app).delete(`/api/roles/${ systemRoleId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('APPROLE_005A_SYSTEM_ROLE');
        });

        it('never leaves a role created through the API marked as a system role', async () => {
            const rows = await sequelize.query<{ count: string }>(
                `SELECT count(*) AS count FROM "appRole"
                 WHERE "isSystemRole" = true AND "appDetails"::text LIKE '%ESAVI-APPROLE-001%'
                 AND "roleId" <> :systemRoleId`,
                { replacements: { systemRoleId }, type: QueryTypes.SELECT }
            );

            expect(Number(rows[0].count)).toBe(0);
        });

    });

    describe('retirement guards', () => {

        it('rejects retiring a role with active carriers and reports the count', async () => {
            const carriedId = await createRoleFixture('carried', 18);

            const assignment = await request(app)
                .post('/api/user-roles')
                .set(authHeader('SUPERADMIN'))
                .send({ userId: getTestUser('ANALYTICS').userId, roleId: carriedId });
            expect(assignment.status).toBe(201);

            const byId = await request(app).get(`/api/roles/${ carriedId }`).set(authHeader('USER'));
            expect(byId.body.data.activeUserCount).toBe(1);

            const response = await request(app).delete(`/api/roles/${ carriedId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_005A_HAS_ACTIVE_ASSIGNMENTS');
            expect(response.body.message).toContain('1');
        });

        it('rejects retiring the SUPERADMIN role even for a SUPERADMIN, carriers or not', async () => {
            const response = await request(app)
                .delete(`/api/roles/${ superAdminRoleId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_005A_SUPERADMIN_ROLE');
        });

        it('stops an ADMIN one guard earlier, on the system-role check', async () => {
            // The seeded SUPERADMIN role carries isSystemRole, and the guards run in the order
            // of section 3.5: system role first, SUPERADMIN code second
            const response = await request(app)
                .delete(`/api/roles/${ superAdminRoleId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('APPROLE_005A_SYSTEM_ROLE');
        });

        it('rejects reactivating over a name already taken by an active role', async () => {
            // Only the name path is reachable: UQ_appRole_code is global and does not filter by
            // isActive, so no other row can ever hold a retired role's code
            const retiredId = await createRoleFixture('name_clash', 14);
            const retiredName = (await AppRole.findByPk(retiredId))!.getDataValue('name');

            expect((await request(app).delete(`/api/roles/${ retiredId }`).set(authHeader('ADMIN'))).status).toBe(200);

            const squatterId = await createRoleFixture('squatter', 13);
            await AppRole.update({ name: retiredName }, { where: { roleId: squatterId } });

            const response = await request(app)
                .patch(`/api/roles/activate/${ retiredId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('APPROLE_005B_NAME_EXISTS');

            // Restored so the GROUP BY assertion above stays meaningful for later runs
            await AppRole.update({ name: `SQUATTER_${ suffix }` }, { where: { roleId: squatterId } });
        });

    });

    describe('rejected body fields', () => {

        const base = { description: 'x', level: 10 };

        it.each([
            ['isSystemRole', true],
            ['isActive', false],
            ['roleId', '00000000-0000-4000-8000-000000000000']
        ])('rejects %s in the body of create with 400', async ( field, value ) => {
            const response = await createRole('ADMIN', {
                ...base,
                code: `reject_${ field }_${ suffix }`,
                name: `reject_${ field }_${ suffix }`,
                [field]: value
            });

            expect(response.status).toBe(400);
        });

        it.each([
            ['isSystemRole', true],
            ['isActive', false],
            ['roleId', '00000000-0000-4000-8000-000000000000']
        ])('rejects %s in the body of update with 400', async ( field, value ) => {
            const response = await request(app)
                .put(`/api/roles/${ systemRoleId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ [field]: value });

            expect(response.status).toBe(400);
        });

        it.each([
            ['missing level', { code: `no_level_${ suffix }`, name: `no_level_${ suffix }`, description: 'x' }],
            ['negative level', { code: `neg_level_${ suffix }`, name: `neg_level_${ suffix }`, description: 'x', level: -1 }],
            ['non-numeric level', { code: `str_level_${ suffix }`, name: `str_level_${ suffix }`, description: 'x', level: 'alto' }]
        ])('rejects create with %s', async ( _label, payload ) => {
            expect((await createRole('ADMIN', payload)).status).toBe(400);
        });

    });

    describe('effective authorization', () => {

        // The point of the spec: before the roleValidation fix, a role created through the
        // API resolved to level 0 and authorized nothing
        it('a level 60 role created by the API passes ADMIN routes and is refused SUPERADMIN ones', async () => {
            const roleId = await createRoleFixture('supervisor', 60);

            const user = await request(app)
                .post('/api/users')
                .set(authHeader('SUPERADMIN'))
                .send({
                    email: `supervisor.${ suffix.toLowerCase() }@test.local`,
                    password: 'TestPassword123!',
                    firstName: 'Supervisor',
                    lastName: 'Probe',
                    roleId
                });
            expect(user.status).toBe(201);

            const token = await jwtGenerate({ userId: user.body.data.userId }) as string;
            const header = { Authorization: `Bearer ${ token }` };

            // validateUserRole(ADMIN) — 50, below 60
            expect((await request(app).get('/api/roles/admin').set(header)).status).toBe(200);

            // validateUserRole(SUPERADMIN) — 100, above 60
            expect(
                (await request(app)
                    .patch('/api/roles/activate/00000000-0000-4000-8000-000000000000')
                    .set(header)).status
            ).toBe(403);
        });

        it('leaves every route reading its required level from ROLE_LEVELS', async () => {
            // An existing SUPERADMIN keeps authorizing exactly as before the fix
            expect((await request(app).get('/api/roles/admin').set(authHeader('SUPERADMIN'))).status).toBe(200);
            expect((await request(app).get('/api/roles/admin').set(authHeader('USER'))).status).toBe(403);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const roleId = await createRoleFixture('DIFF', 20);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/roles',
                id: roleId,
                model: AppRole,
                // The update validator rejects the three with a 400
                strip: ['roleId', 'isActive', 'isSystemRole']
            });
        });

    });

});
