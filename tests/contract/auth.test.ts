import bcrypt from 'bcrypt';
import request from 'supertest';
import { app } from '../../src/app';
import { AppPasswordReset, AppRole, AppSession, AppUser, AppUserRole, SystemConfig } from '../../src/models';
import { ROLES } from '../../src/constants/roles.constants';
import * as mailService from '../../src/services/common/mail.service';
import * as sessionService from '../../src/services/appSession.service';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { MailMessage } from '../../src/types';
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
// One pool for the whole file: the two describes below share it, so the connection is closed
// here — at file level, after the last of them — and not inside either one
afterAll(async () => {
    await closeTestDatabase();
});

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


/**
 * SPEC F43 — self-service password reset.
 *
 * The walkthrough is request → email → consume → log in with the new password, plus the four
 * behaviours the spec calls out by name: the indistinguishability of the 006, the rejection of a
 * reused token, the rejection of an expired one, and the propagation to ESAVI-USER-006.
 *
 * The link is read from the message handed to the transport, never from the database: the row
 * keeps only `sha256(secret)`, so the clear-text token exists exactly once — in the email — and
 * that is precisely why the test captures it there.
 */
describe('password reset contract — SPEC F43', () => {

    const resetEmail = 'reset.contract@test.local';
    const originalPassword = 'ResetContract123!';
    const inactiveEmail = 'reset.inactive@test.local';
    const chosenPassword = 'BrandNewContract456!';
    const unknownResetId = '22222222-2222-4222-8222-222222222222';

    let resetUserId = '';
    const sentMail: MailMessage[] = [];
    let sendSpy: jest.SpyInstance;

    const login = ( email: string, password: string ) =>
        request(app).post('/api/auth/login').send({ email, password });

    const refresh = ( refreshToken: string ) =>
        request(app).post('/api/auth/refresh').send({ refreshToken });

    const forgotPassword = ( email: string ) =>
        request(app).post('/api/auth/forgot-password').send({ email });

    const resetPassword = ( token: string, newPassword: string ) =>
        request(app).post('/api/auth/reset-password').send({ token, newPassword });

    // The token travels in both bodies of the message; the text one is enough to read it
    const tokenFromLastEmail = (): string => {
        const match = /[?&]token=([^"'\s<]+)/.exec(sentMail[sentMail.length - 1].text);

        if( !match ) {
            throw new Error('The last email carried no reset link');
        }
        return match[1];
    }

    const requestLink = async (): Promise<string> => {
        await forgotPassword(resetEmail);
        return tokenFromLastEmail();
    }

    const liveResetsOf = ( userId: string ) =>
        AppPasswordReset.count({ where: { userId, usedAt: null, invalidatedAt: null, deletedAt: null } });

    beforeAll(async () => {
        // Two fixtures of its own: this suite rewrites passwords, and the shared users of
        // tests/setup/auth.ts are the credential every later suite logs in with
        const [active] = await AppUser.findOrCreate({
            where: { email: esaviCrypt(resetEmail) },
            defaults: {
                username: esaviCrypt(resetEmail),
                email: esaviCrypt(resetEmail),
                passwordHash: await bcrypt.hash(originalPassword, 10),
                displayName: esaviCrypt('Reset Contract'),
                requiresPasswordChange: true,
                isActive: true
            }
        });
        resetUserId = active.getDataValue('userId');

        // The USER role, needed only by the ESAVI-USER-006 block: PATCH /api/users/me/password
        // carries validateUserRole(USER), while the two routes of this spec carry no role at all
        const userRole = await AppRole.findOne({ where: { code: ROLES.USER } });
        await AppUserRole.findOrCreate({
            where: { userId: resetUserId, roleId: userRole!.getDataValue('roleId') },
            defaults: { userId: resetUserId, roleId: userRole!.getDataValue('roleId'), isActive: true }
        });

        await AppUser.findOrCreate({
            where: { email: esaviCrypt(inactiveEmail) },
            defaults: {
                username: esaviCrypt(inactiveEmail),
                email: esaviCrypt(inactiveEmail),
                passwordHash: await bcrypt.hash(originalPassword, 10),
                displayName: esaviCrypt('Reset Inactive'),
                requiresPasswordChange: false,
                isActive: false
            }
        });

        // The transport is already jsonTransport under NODE_ENV=test, so this spy is about
        // reading the composed message, not about avoiding the network — nothing reached it
        sendSpy = jest.spyOn(mailService, 'sendMailService').mockImplementation(async ( message ) => {
            sentMail.push(message);
            return { accepted: [message.to] };
        });
    });

    afterAll(() => {
        sendSpy.mockRestore();
    });

    beforeEach(async () => {
        sentMail.length = 0;
        await AppPasswordReset.destroy({ where: { userId: resetUserId }, force: true });
        await AppUser.update(
            { passwordHash: await bcrypt.hash(originalPassword, 10), requiresPasswordChange: true, isActive: true },
            { where: { userId: resetUserId } }
        );
        await AppSession.update(
            { revokedAt: new Date(), revokedReason: 'LOGOUT_ALL' },
            { where: { userId: resetUserId, revokedAt: null } }
        );
    });

    // ESAVI-AUTH-006
    describe('requesting a reset link', () => {

        it('answers exactly the same for an account, a missing one and an inactive one', async () => {
            const existing = await forgotPassword(resetEmail);
            const missing = await forgotPassword('nobody.at.all@test.local');
            const inactive = await forgotPassword(inactiveEmail);

            // Same status, same message, same exact body in the three cases. The only observable
            // difference is in the database and in the user's inbox
            expect(existing.status).toBe(200);
            expect(missing.status).toBe(200);
            expect(inactive.status).toBe(200);
            expect(missing.body).toEqual(existing.body);
            expect(inactive.body).toEqual(existing.body);
        });

        it('answers { ok, message } with no data key', async () => {
            const response = await forgotPassword(resetEmail);

            expect(response.body.ok).toBe(true);
            expect(typeof response.body.message).toBe('string');
            expect('data' in response.body).toBe(false);
        });

        it('writes a row with a 64 hex hash and mails a link with the composite token', async () => {
            await forgotPassword(resetEmail);

            const rows = await AppPasswordReset.findAll({ where: { userId: resetUserId } });
            expect(rows).toHaveLength(1);
            expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);

            const minutes = Math.round(( rows[0].expiresAt.getTime() - Date.now() ) / 60000);
            expect(minutes).toBe(30);

            // `<uuid>.<43 base64url characters>`, the composite format of §3.3
            expect(tokenFromLastEmail()).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
            expect(sentMail[0].html).toContain('http');
            expect(sentMail[0].text).toContain('http');
        });

        it('never puts the token in the row, the audit trail or the response', async () => {
            const response = await forgotPassword(resetEmail);
            const token = tokenFromLastEmail();
            const secret = token.split('.')[1];
            const row = await AppPasswordReset.findByPk(token.split('.')[0]);

            expect(row!.tokenHash).not.toContain(secret);
            expect(JSON.stringify(row!.appDetails)).not.toContain(secret);
            expect(JSON.stringify(response.body)).not.toContain(secret);
        });

        it('supersedes the previous request, so only the last link is live', async () => {
            const firstToken = await requestLink();
            await forgotPassword(resetEmail);

            const first = await AppPasswordReset.findByPk(firstToken.split('.')[0]);
            expect(first!.invalidatedReason).toBe('SUPERSEDED');
            expect(first!.invalidatedAt).not.toBeNull();
            expect(await liveResetsOf(resetUserId)).toBe(1);
        });

        it('writes nothing and sends nothing for an address with no active account', async () => {
            await forgotPassword('nobody.at.all@test.local');
            await forgotPassword(inactiveEmail);

            expect(sentMail).toHaveLength(0);
            expect(await AppPasswordReset.count({ where: { userId: resetUserId } })).toBe(0);
        });

        it('still answers 200 when the delivery fails', async () => {
            sendSpy.mockRejectedValueOnce(new Error('SMTP is unreachable'));

            const response = await forgotPassword(resetEmail);

            // The row is written and the client cannot tell this case from a successful send: a
            // 500 here could only ever happen on the path where the account does exist
            expect(response.status).toBe(200);
            expect(await liveResetsOf(resetUserId)).toBe(1);
        });

        it('rejects a body with no email and one with a malformed address', async () => {
            expect((await request(app).post('/api/auth/forgot-password').send({})).status).toBe(400);
            expect((await forgotPassword('no-es-un-correo')).status).toBe(400);
        });
    });

    // ESAVI-AUTH-007
    describe('consuming the reset link', () => {

        it('resets the password, and the new one logs in while the old one does not', async () => {
            const token = await requestLink();

            const response = await resetPassword(token, chosenPassword);

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect('data' in response.body).toBe(false);

            expect((await login(resetEmail, chosenPassword)).status).toBe(200);
            expect((await login(resetEmail, originalPassword)).status).toBe(401);
        });

        it('marks usedAt, clears requiresPasswordChange and revokes every session', async () => {
            const token = await requestLink();
            const session = await login(resetEmail, originalPassword);

            await resetPassword(token, chosenPassword);

            const row = await AppPasswordReset.findByPk(token.split('.')[0]);
            const user = await AppUser.findByPk(resetUserId);
            const sessions = await AppSession.findAll({ where: { userId: resetUserId, revokedAt: null } });

            expect(row!.usedAt).not.toBeNull();
            // The new password was chosen by its owner, so nothing is imposed any more
            expect(user!.requiresPasswordChange).toBe(false);
            expect(sessions).toHaveLength(0);

            const revoked = await AppSession.findByPk(session.body.data.refreshToken.split('.')[0]);
            expect(revoked!.revokedReason).toBe('PASSWORD_RESET');
            expect((await refresh(session.body.data.refreshToken)).status).toBe(401);
        });

        it('rejects the same token a second time and closes what is still live', async () => {
            const token = await requestLink();
            await resetPassword(token, chosenPassword);

            // A live sibling, minted after the consumption, is what the defensive invalidation
            // has to reach
            await forgotPassword(resetEmail);
            const siblingToken = tokenFromLastEmail();

            const response = await resetPassword(token, 'AnotherPassword789!');

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_007_RESET_TOKEN_USED');

            const sibling = await AppPasswordReset.findByPk(siblingToken.split('.')[0]);
            expect(sibling!.invalidatedReason).toBe('REUSE_DETECTED');
            expect(await liveResetsOf(resetUserId)).toBe(0);
        });

        it('rejects an expired token', async () => {
            const token = await requestLink();
            await AppPasswordReset.update(
                { expiresAt: new Date(Date.now() - 60000), createdAt: new Date(Date.now() - 120000) },
                { where: { resetId: token.split('.')[0] }, silent: true }
            );

            const response = await resetPassword(token, chosenPassword);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_007_RESET_TOKEN_EXPIRED');
        });

        it('rejects a token displaced by a later request', async () => {
            const token = await requestLink();
            await forgotPassword(resetEmail);

            const response = await resetPassword(token, chosenPassword);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_007_RESET_TOKEN_INVALIDATED');
        });

        it('answers the invalid cases with one code and one message', async () => {
            const token = await requestLink();
            const [resetId, secret] = token.split('.');
            const otherSecret = secret.slice(0, -1) + ( secret.endsWith('a') ? 'b' : 'a' );

            const malformed = await resetPassword('not-a-token', chosenPassword);
            const unknownId = await resetPassword(`${ unknownResetId }.${ secret }`, chosenPassword);
            const badSecret = await resetPassword(`${ resetId }.${ otherSecret }`, chosenPassword);

            for( const response of [malformed, unknownId, badSecret] ) {
                // 401 and never 404: a 404 over a resetId that does not exist would confirm which
                // ones do
                expect(response.status).toBe(401);
                expect(response.body.code).toBe('AUTH_007_INVALID_RESET_TOKEN');
            }
            expect(unknownId.body.message).toBe(malformed.body.message);
            expect(badSecret.body.message).toBe(malformed.body.message);
        });

        it('rejects the token of a user deactivated after the link was sent', async () => {
            const token = await requestLink();
            await AppUser.update({ isActive: false }, { where: { userId: resetUserId } });

            const response = await resetPassword(token, chosenPassword);

            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_007_INVALID_RESET_TOKEN');
        });

        it('accepts a new password identical to the one in force', async () => {
            const token = await requestLink();

            // No 409 SAME_PASSWORD here: whoever arrives with a valid token is circumventing
            // nothing, and the check would only tell them they guessed the current password
            const response = await resetPassword(token, originalPassword);

            expect(response.status).toBe(200);
        });

        it('rejects a body with no token and one with a short password', async () => {
            expect((await request(app).post('/api/auth/reset-password').send({})).status).toBe(400);
            expect((await resetPassword('abc.def', 'short')).status).toBe(400);
        });

        it('changes nothing when one of the four writes fails', async () => {
            const token = await requestLink();
            const session = await login(resetEmail, originalPassword);
            const hashBefore = (await AppUser.findByPk(resetUserId))!.passwordHash;

            const revokeSpy = jest
                .spyOn(sessionService, 'revokeAllUserSessionsService')
                .mockRejectedValueOnce(new Error('forced failure'));

            const response = await resetPassword(token, chosenPassword);
            revokeSpy.mockRestore();

            expect(response.status).toBe(500);
            // All or nothing: the password did not move, the token was not spent and the session
            // is still open
            expect((await AppUser.findByPk(resetUserId))!.passwordHash).toBe(hashBefore);
            expect((await AppPasswordReset.findByPk(token.split('.')[0]))!.usedAt).toBeNull();
            expect((await refresh(session.body.data.refreshToken)).status).toBe(200);
        });
    });

    // ESAVI-USER-006
    describe('changing the password invalidates the pending requests', () => {

        const changePassword = ( accessToken: string, currentPassword: string, newPassword: string ) =>
            request(app)
                .patch('/api/users/me/password')
                .set('Authorization', `Bearer ${ accessToken }`)
                .send({ currentPassword, newPassword });

        it('closes a live request with PASSWORD_CHANGED', async () => {
            const token = await requestLink();
            const session = await login(resetEmail, originalPassword);

            const changed = await changePassword(session.body.data.token, originalPassword, 'ChangedContract456!');
            expect(changed.status).toBe(200);

            const row = await AppPasswordReset.findByPk(token.split('.')[0]);
            expect(row!.invalidatedReason).toBe('PASSWORD_CHANGED');
            expect((await resetPassword(token, 'Whatever12345!')).body.code).toBe('AUTH_007_RESET_TOKEN_INVALIDATED');
        });

        it('leaves the pending request live when the change fails', async () => {
            const token = await requestLink();
            const session = await login(resetEmail, originalPassword);

            const failed = await changePassword(session.body.data.token, 'ClaveIncorrecta999!', 'ChangedContract456!');
            expect(failed.status).toBe(401);

            // The trigger of the propagation is the effective write, never the presence of the key
            const row = await AppPasswordReset.findByPk(token.split('.')[0]);
            expect(row!.invalidatedAt).toBeNull();
            expect((await resetPassword(token, 'ChangedContract456!')).status).toBe(200);
        });
    });

    // §3.6 — the precedence this spec fixes for the first time
    describe('configuration precedence', () => {

        it('uses the value in the database over the one in the environment', async () => {
            process.env.ESAVI_PASSWORD_RESET_URL = 'https://from-the-environment.test/reset';

            await forgotPassword(resetEmail);

            delete process.env.ESAVI_PASSWORD_RESET_URL;

            // The row seeded by tests/setup/database.ts wins
            expect(sentMail[0].text).toContain('https://esavi.test/reset?token=');
            expect(sentMail[0].text).not.toContain('from-the-environment');
        });

        it('reads the configuration on every send, with no cache', async () => {
            await forgotPassword(resetEmail);

            await SystemConfig.update(
                { value: 'https://changed-mid-run.test/reset' },
                { where: { code: 'ESAVI_PASSWORD_RESET_URL', scope: 'AUTH' }, silent: true }
            );
            await forgotPassword(resetEmail);

            await SystemConfig.update(
                { value: 'https://esavi.test/reset' },
                { where: { code: 'ESAVI_PASSWORD_RESET_URL', scope: 'AUTH' }, silent: true }
            );

            // Two sends in the same process, two configurations, no restart in between
            expect(sentMail[0].text).toContain('https://esavi.test/reset?token=');
            expect(sentMail[1].text).toContain('https://changed-mid-run.test/reset?token=');
        });
    });
});
