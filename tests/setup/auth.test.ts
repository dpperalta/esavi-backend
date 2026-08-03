import request from 'supertest';
import { app } from '../../src/app';
import { closeTestDatabase } from './database';
import { seedTestUsers, getTestUser, authHeader, TEST_ROLES } from './auth';

describe('test token issuer', () => {

    beforeAll(async () => {
        await seedTestUsers();
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    it('creates one user per canonical role', () => {
        for( const role of TEST_ROLES ) {
            const user = getTestUser(role);

            expect(user.role).toBe(role);
            expect(user.userId).toMatch(/^[0-9a-f-]{36}$/);
            expect(user.token).toEqual(expect.any(String));
        }
    });

    it('issues a distinct token per role', () => {
        const tokens = TEST_ROLES.map(role => getTestUser(role).token);

        expect(new Set(tokens).size).toBe(TEST_ROLES.length);
    });

    // GET /api/catalog-types requires USER (ESAVI-CATTYPE-002)
    it('returns 200 on an authenticated GET with the USER token', async () => {
        const response = await request(app)
            .get('/api/catalog-types')
            .set(authHeader('USER'));

        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
    });

    it('returns 401 on the same GET without a token', async () => {
        const response = await request(app).get('/api/catalog-types');

        expect(response.status).toBe(401);
        expect(response.body.ok).toBe(false);
    });

});
