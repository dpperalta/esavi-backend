import request from 'supertest';
import { app } from '../../src/app';
import { AppRole, AppUser, AppUserRole } from '../../src/models';
import { jwtGenerate } from '../../src/helpers/jwt.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader, getTestUser } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine appUser operations of SPEC F04. It walks the entity end to
 * end — create, own profile, getById, both listings, update, password change, login with
 * the new one, deactivate and reactivate — and covers the error paths the spec exists to
 * fix: the two uniqueness rules that used to surface as a 500, the role escalation guard,
 * the two deactivation guards and the wrong current password.
 *
 * No cleanup: TRG_appUser_preventPhysicalDelete blocks physical deletes, and globalSetup
 * recreates the database from esaviapp.sql on every run.
 */
describe('appUser contract', () => {

    const suffix = Date.now().toString(36);
    const initialPassword = 'InitialPassword1';

    // errorHandler logs every error it handles, and half of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    // Fixtures shared by the whole file
    let userRoleId: string;
    let adminRoleId: string;
    let superAdminRoleId: string;

    const createUser = async ( role: TestRole, payload: Record<string, unknown> ) =>
        request(app).post('/api/users').set(authHeader(role)).send(payload);

    /**
     * A user created through the API, with a token minted directly. Tokens do not go
     * through POST /auth/login so a regression there fails only its own tests.
     */
    const createUserFixture = async (
        label: string,
        overrides: Record<string, unknown> = {},
        as: TestRole = 'SUPERADMIN'
    ): Promise<{ userId: string, email: string, token: string }> => {
        const email = `${ label }.${ suffix }@test.local`;
        const response = await createUser(as, {
            email,
            password: initialPassword,
            firstName: label,
            lastName: 'Fixture',
            roleId: userRoleId,
            ...overrides
        });

        expect(response.status).toBe(201);

        const userId = response.body.data.userId;

        return { userId, email, token: await jwtGenerate({ userId }) as string };
    };

    const bearer = ( token: string ): Record<string, string> => ({ Authorization: `Bearer ${ token }` });

    const login = ( email: string, password: string ) =>
        request(app).post('/api/auth/login').send({ email, password });

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        userRoleId = (await AppRole.findOne({ where: { code: 'USER' } }))!.getDataValue('roleId');
        adminRoleId = (await AppRole.findOne({ where: { code: 'ADMIN' } }))!.getDataValue('roleId');
        superAdminRoleId = (await AppRole.findOne({ where: { code: 'SUPERADMIN' } }))!.getDataValue('roleId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('full lifecycle', () => {

        let userId: string;
        let token: string;
        const email = `  Lifecycle.${ suffix }@Test.LOCAL  `;
        const normalizedEmail = `lifecycle.${ suffix }@test.local`;
        const username = `lifecycle_${ suffix }`;
        const newPassword = 'ChangedPassword1';

        // ESAVI-USER-001
        it('create responds 201 with the envelope, normalized and decrypted', async () => {
            const response = await createUser('ADMIN', {
                username: `  ${ username }  `,
                email,
                password: initialPassword,
                firstName: 'juan carlos',
                lastName: 'perez',
                phone: '0999999999',
                roleId: userRoleId
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data.userId).toEqual(expect.any(String));
            // Normalized before encrypting, and returned decrypted
            expect(response.body.data.email).toBe(normalizedEmail);
            expect(response.body.data.username).toBe(username);
            expect(response.body.data.firstName).toBe('Juan Carlos');
            expect(response.body.data.lastName).toBe('Perez');
            // displayName is calculated from the already normalized names
            expect(response.body.data.displayName).toBe('Juan Carlos Perez');
            expect(response.body.data.phone).toBe('0999999999');
            expect(response.body.data.requiresPasswordChange).toBe(true);
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data).not.toHaveProperty('passwordHash');
            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data.roles).toHaveLength(1);
            expect(response.body.data.roles[0].level).toEqual(expect.any(Number));

            userId = response.body.data.userId;
            token = await jwtGenerate({ userId }) as string;
        });

        it('create writes one appDetails entry with the operation code', async () => {
            const response = await request(app).get(`/api/users/${ userId }`).set(authHeader('ADMIN'));

            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0]).toEqual(
                expect.objectContaining({ method: 'ESAVI-USER-001', user: getTestUser('ADMIN').userId })
            );
        });

        // ESAVI-USER-007
        it('own profile responds 200 to the holder, who is only a USER', async () => {
            const response = await request(app).get('/api/users/me').set(bearer(token));

            expect(response.status).toBe(200);
            expect(response.body.data.userId).toBe(userId);
            expect(response.body.data.email).toBe(normalizedEmail);
            expect(response.body.data).not.toHaveProperty('passwordHash');
        });

        it('that same USER is still refused by getById and by the listing', async () => {
            expect((await request(app).get(`/api/users/${ userId }`).set(bearer(token))).status).toBe(403);
            expect((await request(app).get('/api/users').set(bearer(token))).status).toBe(403);
        });

        // ESAVI-USER-003
        it('getById responds 200 with roles, status and no sysDetails', async () => {
            const response = await request(app).get(`/api/users/${ userId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.userId).toBe(userId);
            expect(response.body.data.roles[0].level).toEqual(expect.any(Number));
            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data).not.toHaveProperty('passwordHash');
        });

        it('getById responds 404 for an unknown id', async () => {
            const response = await request(app)
                .get('/api/users/00000000-0000-4000-8000-000000000000')
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('USER_003_NOT_FOUND');
        });

        it('getById does not capture admin, me or activate as an id', async () => {
            expect((await request(app).get('/api/users/admin').set(authHeader('ADMIN'))).status).toBe(200);
            expect((await request(app).get('/api/users/me').set(authHeader('ADMIN'))).status).toBe(200);
        });

        // ESAVI-USER-002A
        it('list responds 200 with { count, rows }, decrypted and without appDetails', async () => {
            const response = await request(app).get('/api/users?limit=100').set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('count');
            expect(Array.isArray(response.body.data.rows)).toBe(true);

            const row = response.body.data.rows.find((entry: { userId: string }) => entry.userId === userId);
            expect(row).toBeDefined();
            expect(row.email).toBe(normalizedEmail);
            expect(row).not.toHaveProperty('appDetails');
            expect(row).not.toHaveProperty('passwordHash');
            expect(row).not.toHaveProperty('sysDetails');
        });

        it('both listings are ordered by createdAt DESC', async () => {
            const response = await request(app).get('/api/users/admin?limit=100').set(authHeader('ADMIN'));

            const rows = response.body.data.rows as { createdAt: string }[];
            for( let index = 1; index < rows.length; index++ ) {
                expect(new Date(rows[index - 1].createdAt).getTime())
                    .toBeGreaterThanOrEqual(new Date(rows[index].createdAt).getTime());
            }
        });

        // ESAVI-USER-004
        it('update responds 200, recalculates displayName and preserves the history', async () => {
            const response = await request(app)
                .put(`/api/users/${ userId }`)
                .set(authHeader('ADMIN'))
                .send({ firstName: 'maria fernanda' });

            expect(response.status).toBe(200);
            expect(response.body.data.firstName).toBe('Maria Fernanda');
            expect(response.body.data.displayName).toBe('Maria Fernanda Perez');

            const appDetails = response.body.data.appDetails as { method: string }[];
            expect(appDetails).toHaveLength(2);
            expect(appDetails[0].method).toBe('ESAVI-USER-001');
            expect(appDetails[1].method).toBe('ESAVI-USER-004');
        });

        it('a no-op update responds 200 without appending an audit entry', async () => {
            const response = await request(app)
                .put(`/api/users/${ userId }`)
                .set(authHeader('ADMIN'))
                .send({});

            expect(response.status).toBe(200);
            expect(response.body.data.firstName).toBe('Maria Fernanda');
            // An update that touched nothing is not a change: appDetails stays on the create
            // entry and the real update of the previous case
            expect(response.body.data.appDetails).toHaveLength(2);
        });

        it('resending the stored firstName neither writes nor recomposes displayName', async () => {
            const before = await AppUser.findByPk(userId);

            const response = await request(app)
                .put(`/api/users/${ userId }`)
                .set(authHeader('ADMIN'))
                .send({ firstName: 'Maria Fernanda' });

            expect(response.status).toBe(200);
            expect(response.body.data.displayName).toBe('Maria Fernanda Perez');

            const after = await AppUser.findByPk(userId);
            expect(after!.getDataValue('displayName')).toBe(before!.getDataValue('displayName'));
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
            expect(response.body.data.appDetails).toHaveLength(2);
        });

        it('changing the lastName moves both the lastName and the displayName', async () => {
            const response = await request(app)
                .put(`/api/users/${ userId }`)
                .set(authHeader('ADMIN'))
                .send({ lastName: 'nuevo apellido' });

            expect(response.status).toBe(200);
            expect(response.body.data.lastName).toBe('Nuevo Apellido');
            expect(response.body.data.displayName).toBe('Maria Fernanda Nuevo Apellido');
            expect(response.body.data.appDetails).toHaveLength(3);
        });

        // ESAVI-USER-006
        it('password change responds 200 without data and clears requiresPasswordChange', async () => {
            const response = await request(app)
                .patch('/api/users/me/password')
                .set(bearer(token))
                .send({ currentPassword: initialPassword, newPassword });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppUser.findByPk(userId);
            expect(row!.getDataValue('requiresPasswordChange')).toBe(false);
        });

        it('the new password logs in and the old one does not', async () => {
            expect((await login(normalizedEmail, newPassword)).status).toBe(200);
            expect((await login(normalizedEmail, initialPassword)).status).toBe(401);
        });

        it('the email is case insensitive on login, both ways', async () => {
            expect((await login(normalizedEmail.toUpperCase(), newPassword)).status).toBe(200);
            expect((await login(`  ${ normalizedEmail }  `, newPassword)).status).toBe(200);
        });

        // ESAVI-USER-005A
        it('delete responds 200 without data and seals deletedAt', async () => {
            const response = await request(app).delete(`/api/users/${ userId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppUser.findByPk(userId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();
        });

        it('a deactivated user leaves the public list and getById, but stays in the admin list', async () => {
            const list = await request(app).get('/api/users?limit=100').set(authHeader('ADMIN'));
            expect(list.body.data.rows.map((row: { userId: string }) => row.userId)).not.toContain(userId);

            const adminList = await request(app).get('/api/users/admin?limit=100').set(authHeader('ADMIN'));
            expect(adminList.body.data.rows.map((row: { userId: string }) => row.userId)).toContain(userId);

            expect((await request(app).get(`/api/users/${ userId }`).set(authHeader('ADMIN'))).status).toBe(404);
            // canViewInactive is SUPERADMIN only
            expect((await request(app).get(`/api/users/${ userId }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
        });

        it('a second delete responds 409 ALREADY_INACTIVE', async () => {
            const response = await request(app).delete(`/api/users/${ userId }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_005A_ALREADY_INACTIVE');
        });

        // ESAVI-USER-005B
        it('activate responds 200 without data and clears deletedAt', async () => {
            const response = await request(app)
                .patch(`/api/users/activate/${ userId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');

            const row = await AppUser.findByPk(userId);
            expect(row!.getDataValue('isActive')).toBe(true);
            expect(row!.getDataValue('deletedAt')).toBeNull();
        });

        it('activate requires SUPERADMIN', async () => {
            const response = await request(app)
                .patch(`/api/users/activate/${ userId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(403);
        });

        it('a second activate responds 409 ALREADY_ACTIVE', async () => {
            const response = await request(app)
                .patch(`/api/users/activate/${ userId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_005B_ALREADY_ACTIVE');
        });

        it('appDetails.method carries the bare operation code, with no _ACTIVATION suffix', async () => {
            const row = await AppUser.findByPk(userId);
            const methods = (row!.getDataValue('appDetails') as { method: string }[]).map(entry => entry.method);

            expect(methods).toContain('ESAVI-USER-001');
            expect(methods).toContain('ESAVI-USER-004');
            expect(methods).toContain('ESAVI-USER-006');
            expect(methods).toContain('ESAVI-USER-005A');
            expect(methods).toContain('ESAVI-USER-005B');
            for( const method of methods ) {
                expect(method).not.toMatch(/_ACTIVATION|_DEACTIVATION/);
            }
        });

    });

    describe('uniqueness', () => {

        it('keeps a deactivated user\'s email taken: 409, not a 500 from UQ_appUser_email', async () => {
            const retired = await createUserFixture('retired.email');

            expect((await request(app).delete(`/api/users/${ retired.userId }`).set(authHeader('ADMIN'))).status).toBe(200);

            const response = await createUser('ADMIN', {
                email: retired.email,
                password: initialPassword,
                firstName: 'After',
                lastName: 'Retirement',
                roleId: userRoleId
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_001_EMAIL_EXISTS');
        });

        it('rejects a duplicated username with 409, not a 500 from UQ_appUser_username', async () => {
            const username = `taken_${ suffix }`;
            await createUserFixture('username.occupant', { username });

            const response = await createUser('ADMIN', {
                username,
                email: `username.free.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'Free',
                lastName: 'Email',
                roleId: userRoleId
            });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_001_USERNAME_EXISTS');
        });

        it('creating without a username responds 201', async () => {
            const response = await createUser('ADMIN', {
                email: `no.username.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'No',
                lastName: 'Username',
                roleId: userRoleId
            });

            expect(response.status).toBe(201);
            expect(response.body.data.username).toBeNull();
        });

        it('rejects on update an email that belongs to another user, active or not', async () => {
            const occupant = await createUserFixture('update.occupant');
            const target = await createUserFixture('update.target');

            const response = await request(app)
                .put(`/api/users/${ target.userId }`)
                .set(authHeader('ADMIN'))
                .send({ email: occupant.email });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_004_EMAIL_EXISTS');
        });

    });

    describe('role escalation', () => {

        it('rejects an ADMIN creating a user with the SUPERADMIN role', async () => {
            const response = await createUser('ADMIN', {
                email: `escalate.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'Escalate',
                lastName: 'Attempt',
                roleId: superAdminRoleId
            });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe('USER_001_ROLE_LEVEL_EXCEEDED');
        });

        it('allows an ADMIN to create a user at its own level', async () => {
            const response = await createUser('ADMIN', {
                email: `equal.level.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'Equal',
                lastName: 'Level',
                roleId: adminRoleId
            });

            expect(response.status).toBe(201);
        });

        it('lets a SUPERADMIN assign any role, and an array of them', async () => {
            const response = await createUser('SUPERADMIN', {
                email: `two.roles.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'Two',
                lastName: 'Roles',
                roleId: [superAdminRoleId, userRoleId]
            });

            expect(response.status).toBe(201);
            expect(response.body.data.roles).toHaveLength(2);

            const assignments = await AppUserRole.count({ where: { userId: response.body.data.userId } });
            expect(assignments).toBe(2);
        });

    });

    describe('deactivation guards', () => {

        /**
         * The guard is about the last active SUPERADMIN in the system, and the escalation
         * block leaves carriers behind. The scenario is built explicitly rather than assumed,
         * so the test does not depend on the order the blocks run in.
         */
        const leaveOnlySeededSuperAdmin = async (): Promise<string> => {
            const seeded = getTestUser('SUPERADMIN').userId;
            const assignments = await AppUserRole.findAll({
                where: { roleId: superAdminRoleId, isActive: true }
            });

            for( const assignment of assignments ) {
                const carrier = assignment.getDataValue('userId');
                if( carrier !== seeded ) {
                    await AppUser.update(
                        { isActive: false, deletedAt: new Date() },
                        { where: { userId: carrier } }
                    );
                }
            }
            await AppUser.update({ isActive: true, deletedAt: null }, { where: { userId: seeded } });

            return seeded;
        };

        // Whatever happens above, the rest of the run needs its seeded SUPERADMIN back
        afterAll(async () => {
            await AppUser.update(
                { isActive: true, deletedAt: null },
                { where: { userId: getTestUser('SUPERADMIN').userId } }
            );
        });

        it('refuses to let a user deactivate themselves', async () => {
            const response = await request(app)
                .delete(`/api/users/${ getTestUser('ADMIN').userId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_005A_SELF_DEACTIVATION');
        });

        it('refuses to deactivate the last active SUPERADMIN, and allows it once there are two', async () => {
            const target = await leaveOnlySeededSuperAdmin();

            const asLastOne = await request(app).delete(`/api/users/${ target }`).set(authHeader('ADMIN'));
            expect(asLastOne.status).toBe(409);
            expect(asLastOne.body.code).toBe('USER_005A_LAST_SUPERADMIN');

            // A second carrier makes the first one expendable
            const second = await createUserFixture('second.superadmin', { roleId: superAdminRoleId });

            const withTwo = await request(app).delete(`/api/users/${ second.userId }`).set(authHeader('ADMIN'));
            expect(withTwo.status).toBe(200);

            // And the seeded one is the last again, so the rest of the run keeps its SUPERADMIN
            const backToOne = await request(app).delete(`/api/users/${ target }`).set(authHeader('ADMIN'));
            expect(backToOne.status).toBe(409);
        });

    });

    describe('password change', () => {

        it('rejects a wrong current password with 401', async () => {
            const target = await createUserFixture('wrong.password');

            const response = await request(app)
                .patch('/api/users/me/password')
                .set(bearer(target.token))
                .send({ currentPassword: 'NotTheOne1', newPassword: 'Whatever12' });

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('USER_006_INVALID_CREDENTIALS');
        });

        it('rejects a new password equal to the current one with 409', async () => {
            const target = await createUserFixture('same.password');

            const response = await request(app)
                .patch('/api/users/me/password')
                .set(bearer(target.token))
                .send({ currentPassword: initialPassword, newPassword: initialPassword });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('USER_006_SAME_PASSWORD');
        });

        it('rejects a new password shorter than 8 characters with 400', async () => {
            const target = await createUserFixture('short.password');

            const response = await request(app)
                .patch('/api/users/me/password')
                .set(bearer(target.token))
                .send({ currentPassword: initialPassword, newPassword: 'Short1!' });

            expect(response.status).toBe(400);
        });

    });

    describe('rejected input', () => {

        it('rejects a password shorter than 8 characters on create', async () => {
            const response = await createUser('ADMIN', {
                email: `short.${ suffix }@test.local`,
                password: 'Short1!',
                firstName: 'Short',
                lastName: 'Password',
                roleId: userRoleId
            });

            expect(response.status).toBe(400);
        });

        it('rejects a phone longer than 50 characters', async () => {
            const response = await createUser('ADMIN', {
                email: `long.phone.${ suffix }@test.local`,
                password: initialPassword,
                firstName: 'Long',
                lastName: 'Phone',
                phone: '9'.repeat(51),
                roleId: userRoleId
            });

            expect(response.status).toBe(400);
        });

        it.each(['displayName', 'isActive', 'requiresPasswordChange'])(
            'rejects %s in the create body',
            async ( field ) => {
                const response = await createUser('ADMIN', {
                    email: `rejected.${ field.toLowerCase() }.${ suffix }@test.local`,
                    password: initialPassword,
                    firstName: 'Rejected',
                    lastName: 'Field',
                    roleId: userRoleId,
                    [field]: field === 'displayName' ? 'Forged Name' : true
                });

                expect(response.status).toBe(400);
            }
        );

        it.each(['password', 'roleId', 'displayName'])(
            'rejects %s in the update body',
            async ( field ) => {
                const target = await createUserFixture(`reject.update.${ field.toLowerCase() }`);

                const response = await request(app)
                    .put(`/api/users/${ target.userId }`)
                    .set(authHeader('ADMIN'))
                    .send({ [field]: field === 'roleId' ? userRoleId : 'Something1' });

                expect(response.status).toBe(400);
            }
        );

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const target = await createUserFixture('differential', {
                username: `differential.${ suffix }`,
                phone: '0991234567'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/users',
                id: target.userId,
                model: AppUser,
                // All seven are rejected by the update validator with a 400: displayName is
                // derived, and the rest belong to operations of their own or to an external
                // authentication this API does not support
                strip: [
                    'userId', 'displayName', 'isActive', 'requiresPasswordChange',
                    'roleId', 'externalProvider', 'externalSubject'
                ]
            });
        });

    });

});
