import request from 'supertest';
import { app } from '../../src/app';
import { ROLE_LEVELS, ROLES } from '../../src/constants/roles.constants';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';
import { ROUTE_RULES } from '../setup/routeRules';

/**
 * The role one step below the given one, by numeric level. Returns undefined
 * for ANALYTICS, which is the floor and has nothing below it.
 */
const roleBelow = ( role: TestRole ): TestRole | undefined => {
    const target = ROLE_LEVELS[ROLES[role]];

    const lower = (Object.keys(ROLES) as TestRole[])
        .filter(candidate => ROLE_LEVELS[ROLES[candidate]] < target)
        .sort((a, b) => ROLE_LEVELS[ROLES[b]] - ROLE_LEVELS[ROLES[a]]);

    return lower[0];
};

describe('role matrix', () => {

    // These tests probe authorization with throwaway ids, so the handlers they
    // reach log the resulting 404s and 500s. That output is expected here.
    let consoleError: jest.SpyInstance;

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe.each(ROUTE_RULES)('$code — $method $path', ({ method, path, minRole }) => {

        const below = roleBelow(minRole);

        it(`rejects ${ below } with 403`, async () => {
            const response = await request(app)[method](path).set(authHeader(below as TestRole));

            expect(response.status).toBe(403);
        });

        it(`does not reject ${ minRole } with 403`, async () => {
            const response = await request(app)[method](path).set(authHeader(minRole));

            expect(response.status).not.toBe(403);
        });

    });

    describe('the matrix itself', () => {

        it('covers every route that declares validateUserRole', () => {
            // Bumped deliberately when a route is added, so a new endpoint cannot
            // slip in without a rule in ROUTE_RULES.
            expect(ROUTE_RULES).toHaveLength(354);
        });

        it('has a role below every minimum it uses, so the 403 side is always testable', () => {
            for( const rule of ROUTE_RULES ) {
                expect(roleBelow(rule.minRole)).toBeDefined();
            }
        });

    });

    describe('unauthenticated routes', () => {

        it('GET /api/health needs no token', async () => {
            const response = await request(app).get('/api/health');

            expect(response.status).toBe(200);
        });

        it('POST /api/auth/login needs no token', async () => {
            const response = await request(app)
                .post('/api/auth/login')
                .send({ email: 'nobody@test.local', password: 'wrong-password' });

            // Reaches the handler: bad credentials, not a missing token
            expect([400, 401]).toContain(response.status);
            expect(response.body.message).not.toBe(undefined);
        });

        it('POST /api/auth/forgot-password needs no token', async () => {
            const response = await request(app)
                .post('/api/auth/forgot-password')
                .send({ email: 'nobody@test.local' });

            // Reaches the handler, and always answers 200: whether the account exists is exactly
            // what this endpoint refuses to disclose (SPEC F43 §3.5)
            expect(response.status).toBe(200);
            expect(response.body.message).not.toBe(undefined);
        });

        it('POST /api/auth/reset-password needs no token', async () => {
            const response = await request(app)
                .post('/api/auth/reset-password')
                .send({ token: 'not-a-token', newPassword: 'IrrelevantPassword123!' });

            // Reaches the handler: an invalid reset token, not a missing access token
            expect(response.status).toBe(401);
            expect(response.body.code).toBe('AUTH_007_INVALID_RESET_TOKEN');
        });

    });

});
