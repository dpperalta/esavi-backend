import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../../src/app';
import { AppSession, AppUser } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, getTestUser, authHeader } from '../setup/auth';
import { REFRESH_ABSOLUTE_MAX_IN_MS, REFRESH_TOKEN_EXPIRES_IN_MS } from '../../src/constants/session.constants';

/**
 * SPEC F42 — persisted sessions and token renewal.
 *
 * The walkthrough is login → refresh → logout, plus the three behaviours the spec calls out by
 * name: rotation with reuse detection, the sliding window with its absolute ceiling, and the
 * propagation to ESAVI-USER-006.
 *
 * Every test opens its sessions through the HTTP surface rather than by inserting rows, because
 * what is under test is the contract, not the model. The one exception is the absolute ceiling:
 * there is no way to wait thirty days, so `startedAt` is pushed back directly — and that is
 * precisely the column the mechanism anchors on.
 */
describe('auth contract — SPEC F42', () => {

    const unknownSessionId = '11111111-1111-4111-8111-111111111111';
    const anySecret = 'a'.repeat(43);

    const login = ( email: string, password: string ) =>
        request(app).post('/api/auth/login').send({ email, password });

    const refresh = ( refreshToken: string ) =>
        request(app).post('/api/auth/refresh').send({ refreshToken });

    const logout = ( refreshToken: string ) =>
        request(app).post('/api/auth/logout').send({ refreshToken });

    const logoutAll = ( accessToken: string ) =>
        request(app).post('/api/auth/logout-all').set('Authorization', `Bearer ${ accessToken }`).send();

    const sessionIdOf = ( refreshToken: string ) => refreshToken.split('.')[0];

    const liveSessionsOf = ( userId: string ) =>
        AppSession.count({ where: { userId, revokedAt: null, deletedAt: null } });

    // Every test starts from a clean slate for its own role, so a session left open by a previous
    // test cannot make a revokedCount drift
    const closeEverySessionOf = async ( userId: string ) => {
        await AppSession.update(
            { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
            { where: { userId, revokedAt: null } }
        );
    };

    beforeAll(async () => {
        await seedTestUsers();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    // ESAVI-AUTH-001
    describe('login opens a session', () => {

        it('returns the pair next to the user block it always returned', async () => {
            const user = await getTestUser('USER');
            await closeEverySessionOf(user.userId);

            const response = await login(user.email, user.password);

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            // Additive change: nothing that was there before disappears
            expect(response.body.data).toHaveProperty('token');
            expect(response.body.data).toHaveProperty('user.userId');
            expect(response.body.data).toHaveProperty('refreshToken');
            expect(response.body.data).toHaveProperty('expiresAt');
        });

        it('leaves exactly one live row, with expiresAt at REFRESH_TOKEN_EXPIRES_IN', async () => {
            const user = await getTestUser('USER');
            await closeEverySessionOf(user.userId);

            const response = await login(user.email, user.password);
            const session = await AppSession.findByPk(sessionIdOf(response.body.data.refreshToken));

            expect(await liveSessionsOf(user.userId)).toBe(1);
            expect(session!.revokedAt).toBeNull();

            const span = new Date(session!.expiresAt!).getTime() - new Date(session!.startedAt).getTime();
            // A minute of tolerance: startedAt is stamped by Postgres and expiresAt by Node
            expect(Math.abs(span - REFRESH_TOKEN_EXPIRES_IN_MS)).toBeLessThan(60_000);
        });

        it('stores the hash of the token, never the token', async () => {
            const user = await getTestUser('USER');
            const response = await login(user.email, user.password);
            const refreshToken = response.body.data.refreshToken;
            const session = await AppSession.findByPk(sessionIdOf(refreshToken));

            expect(session!.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
            expect(session!.refreshTokenHash).not.toBe(refreshToken);
            expect(refreshToken).toContain(session!.sessionId);
        });

        it('never exposes a column of appSession beyond expiresAt', async () => {
            const user = await getTestUser('USER');
            const response = await login(user.email, user.password);
            const body = JSON.stringify(response.body);

            for ( const column of ['refreshTokenHash', 'ipAddress', 'userAgent', 'sysDetails', 'appDetails', 'revokedAt', 'revokedReason'] ) {
                expect(body).not.toContain(column);
            }
        });

        it('opens one row per login, so two devices coexist', async () => {
            const user = await getTestUser('USER');
            await closeEverySessionOf(user.userId);

            await login(user.email, user.password);
            await login(user.email, user.password);

            expect(await liveSessionsOf(user.userId)).toBe(2);
        });
    });

    // ESAVI-AUTH-002
    describe('refresh rotates the token', () => {

        it('returns only the tokens — a renewal is not a login', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);

            const response = await refresh(session.body.data.refreshToken);

            expect(response.status).toBe(200);
            expect(Object.keys(response.body.data).sort()).toEqual(['expiresAt', 'refreshToken', 'token']);
            expect(response.body.data.user).toBeUndefined();
        });

        it('issues a different refresh token and rewrites the stored hash', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);
            const original = session.body.data.refreshToken;
            const before = await AppSession.findByPk(sessionIdOf(original));

            const response = await refresh(original);
            const after = await AppSession.findByPk(sessionIdOf(original));

            expect(response.body.data.refreshToken).not.toBe(original);
            expect(after!.refreshTokenHash).not.toBe(before!.refreshTokenHash);
        });

        it('never moves startedAt across three chained renewals', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);
            const sessionId = sessionIdOf(session.body.data.refreshToken);
            const anchor = new Date((await AppSession.findByPk(sessionId))!.startedAt).getTime();

            let current = session.body.data.refreshToken;
            for ( let round = 0; round < 3; round++ ) {
                const response = await refresh(current);
                expect(response.status).toBe(200);
                current = response.body.data.refreshToken;
            }

            const row = await AppSession.findByPk(sessionId);
            expect(new Date(row!.startedAt).getTime()).toBe(anchor);
            // The sliding window may never cross the ceiling anchored on that column
            expect(new Date(row!.expiresAt!).getTime()).toBeLessThanOrEqual(anchor + REFRESH_ABSOLUTE_MAX_IN_MS);
        });

        it('detects reuse and revokes every session of the user', async () => {
            const user = await getTestUser('ANALYTICS');
            await closeEverySessionOf(user.userId);

            const session = await login(user.email, user.password);
            const spent = session.body.data.refreshToken;
            await refresh(spent);
            // A second, unrelated device: reuse takes it down as well
            await login(user.email, user.password);
            expect(await liveSessionsOf(user.userId)).toBe(2);

            const response = await refresh(spent);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_002_REFRESH_TOKEN_REUSED');
            expect(await liveSessionsOf(user.userId)).toBe(0);

            const rows = await AppSession.findAll({ where: { userId: user.userId }, attributes: ['revokedReason'] });
            expect(rows.every(row => row.revokedReason === 'REUSE_DETECTED')).toBe(true);
        });

        it('answers a malformed token and an unknown sessionId identically', async () => {
            const malformed = await refresh('esto-no-es-un-token');
            const unknown = await refresh(`${ unknownSessionId }.${ anySecret }`);

            expect(malformed.status).toBe(401);
            expect(unknown.status).toBe(401);
            // Telling them apart would turn the endpoint into an oracle for which sessions exist
            expect(malformed.body.code).toBe(unknown.body.code);
            expect(malformed.body.message).toBe(unknown.body.message);
            expect(malformed.body.code).toBe('AUTH_002_INVALID_REFRESH_TOKEN');
        });

        it('revokes a session that crossed the absolute ceiling, expiresAt notwithstanding', async () => {
            const user = await getTestUser('ADMIN');
            const session = await login(user.email, user.password);
            const refreshToken = session.body.data.refreshToken;
            const sessionId = sessionIdOf(refreshToken);

            await AppSession.update(
                { startedAt: new Date(Date.now() - REFRESH_ABSOLUTE_MAX_IN_MS - 86_400_000) },
                { where: { sessionId } }
            );

            const response = await refresh(refreshToken);
            const row = await AppSession.findByPk(sessionId);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_002_SESSION_EXPIRED');
            // The row was still inside its sliding window, and it is closed anyway
            expect(new Date(row!.expiresAt!).getTime()).toBeGreaterThan(Date.now());
            expect(row!.revokedReason).toBe('ABSOLUTE_MAX_REACHED');
        });

        it('rejects a revoked session with its own code', async () => {
            const user = await getTestUser('ADMIN');
            const session = await login(user.email, user.password);
            const refreshToken = session.body.data.refreshToken;

            await logout(refreshToken);
            const response = await refresh(refreshToken);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_002_SESSION_REVOKED');
        });

        it('needs no Authorization header', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);

            const response = await request(app)
                .post('/api/auth/refresh')
                .send({ refreshToken: session.body.data.refreshToken });

            expect(response.status).toBe(200);
        });

        it('rejects an empty body through the validator, not with a 500', async () => {
            const response = await request(app).post('/api/auth/refresh').send({});

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });
    });

    // ESAVI-AUTH-003
    describe('logout closes one session', () => {

        it('answers 200 with no data and stamps the reason', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);
            const refreshToken = session.body.data.refreshToken;

            const response = await logout(refreshToken);
            const row = await AppSession.findByPk(sessionIdOf(refreshToken));

            expect(response.status).toBe(200);
            // A state operation returns no data — CONVENTIONS.md §10
            expect(response.body.data).toBeUndefined();
            expect(Object.keys(response.body).sort()).toEqual(['message', 'ok']);
            expect(row!.revokedReason).toBe('LOGOUT');
        });

        it('is idempotent, and does not rewrite the original revokedAt', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);
            const refreshToken = session.body.data.refreshToken;

            await logout(refreshToken);
            const stamp = new Date((await AppSession.findByPk(sessionIdOf(refreshToken)))!.revokedAt!).getTime();

            const second = await logout(refreshToken);
            const row = await AppSession.findByPk(sessionIdOf(refreshToken));

            // Closing something already closed met its goal — that is the whole difference with 002
            expect(second.status).toBe(200);
            expect(new Date(row!.revokedAt!).getTime()).toBe(stamp);
            expect(row!.revokedReason).toBe('LOGOUT');
        });

        it('needs no Authorization header', async () => {
            const user = await getTestUser('USER');
            const session = await login(user.email, user.password);

            const response = await request(app)
                .post('/api/auth/logout')
                .send({ refreshToken: session.body.data.refreshToken });

            expect(response.status).toBe(200);
        });

        it('fires reuse detection on a forged secret over a live session', async () => {
            const user = await getTestUser('ANALYTICS');
            await closeEverySessionOf(user.userId);

            const session = await login(user.email, user.password);
            const forged = `${ sessionIdOf(session.body.data.refreshToken) }.${ 'z'.repeat(43) }`;

            const response = await logout(forged);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_003_REFRESH_TOKEN_REUSED');
            expect(await liveSessionsOf(user.userId)).toBe(0);
        });
    });

    // ESAVI-AUTH-004
    describe('logout-all closes every session', () => {

        it('returns the count, then zero', async () => {
            const user = await getTestUser('USER');
            await closeEverySessionOf(user.userId);

            let accessToken = '';
            for ( let device = 0; device < 3; device++ ) {
                const session = await login(user.email, user.password);
                accessToken = session.body.data.token;
            }

            const first = await logoutAll(accessToken);
            const second = await logoutAll(accessToken);

            expect(first.status).toBe(200);
            expect(first.body.data).toEqual({ revokedCount: 3 });
            expect(second.body.data).toEqual({ revokedCount: 0 });
            expect(await liveSessionsOf(user.userId)).toBe(0);

            const rows = await AppSession.findAll({ where: { userId: user.userId }, attributes: ['revokedReason'] });
            expect(rows.some(row => row.revokedReason === 'LOGOUT_ALL')).toBe(true);
        });

        it('demands a proven identity', async () => {
            const anonymous = await request(app).post('/api/auth/logout-all').send();
            const belowMinimum = await request(app)
                .post('/api/auth/logout-all')
                .set(await authHeader('ANALYTICS'))
                .send();

            expect(anonymous.status).toBe(401);
            expect(belowMinimum.status).toBe(403);
        });

        it('takes the userId from the token and ignores the body', async () => {
            const victim = await getTestUser('ADMIN');
            await closeEverySessionOf(victim.userId);
            await login(victim.email, victim.password);

            await request(app)
                .post('/api/auth/logout-all')
                .set(await authHeader('USER'))
                .send({ userId: victim.userId });

            // Accepting it from the body would make this a denial of service against any account
            expect(await liveSessionsOf(victim.userId)).toBe(1);
        });
    });

    // ESAVI-USER-006
    describe('changing the password closes every session', () => {

        const changePassword = ( accessToken: string, currentPassword: string, newPassword: string ) =>
            request(app)
                .patch('/api/users/me/password')
                .set('Authorization', `Bearer ${ accessToken }`)
                .send({ currentPassword, newPassword });

        it('revokes with PASSWORD_CHANGED and kills the refresh token', async () => {
            const user = await getTestUser('SUPERADMIN');
            await closeEverySessionOf(user.userId);

            const first = await login(user.email, user.password);
            const second = await login(user.email, user.password);

            const response = await changePassword(first.body.data.token, user.password, 'OtraClave456!');

            expect(response.status).toBe(200);
            expect(await liveSessionsOf(user.userId)).toBe(0);

            const rows = await AppSession.findAll({ where: { userId: user.userId }, attributes: ['revokedReason'] });
            expect(rows.every(row => row.revokedReason === 'PASSWORD_CHANGED')).toBe(true);

            const afterChange = await refresh(second.body.data.refreshToken);
            expect(afterChange.status).toBe(401);

            // Leave the fixture as it was found: the password is shared by every later suite
            await AppUser.update(
                { passwordHash: await bcrypt.hash(user.password, 10) },
                { where: { userId: user.userId } }
            );
        });

        it('revokes nothing when the current password is wrong', async () => {
            const user = await getTestUser('ADMIN');
            await closeEverySessionOf(user.userId);

            const session = await login(user.email, user.password);
            const hashBefore = (await AppUser.findByPk(user.userId))!.passwordHash;

            const response = await changePassword(session.body.data.token, 'ClaveIncorrecta999!', 'OtraClave456!');

            expect(response.status).toBe(401);
            // The transaction never committed: neither the password nor the sessions moved
            expect((await AppUser.findByPk(user.userId))!.passwordHash).toBe(hashBefore);
            expect(await liveSessionsOf(user.userId)).toBe(1);
            expect((await refresh(session.body.data.refreshToken)).status).toBe(200);
        });
    });
});
