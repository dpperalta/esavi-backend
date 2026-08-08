import request from 'supertest';
import { app } from '../../src/app';
import { ROLE_LEVELS, ROLES } from '../../src/constants/roles.constants';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteRule {
    method: Method;
    path: string;
    minRole: TestRole;
    code: string;
}

const UUID = '00000000-0000-4000-8000-000000000000';

/**
 * The canonical matrix of section 9 of CONVENTIONS.md, route by route.
 * `validateUserRole(X)` means "level >= level(X)", so every rule is checked from
 * both sides: the role immediately below must get 403, and the exact role must
 * not. Adding a route without adding it here leaves it unguarded by the suite.
 */
const ROUTE_RULES: RouteRule[] = [
    // catalogItem
    { method: 'post',   path: '/api/catalog-items',                     minRole: 'ADMIN',      code: 'ESAVI-CATITEM-001' },
    { method: 'get',    path: `/api/catalog-items/type/${ UUID }`,      minRole: 'USER',       code: 'ESAVI-CATITEM-002A' },
    { method: 'get',    path: `/api/catalog-items/admin/type/${ UUID }`, minRole: 'ADMIN',     code: 'ESAVI-CATITEM-002B' },
    { method: 'get',    path: `/api/catalog-items/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-CATITEM-003' },
    { method: 'put',    path: `/api/catalog-items/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATITEM-004' },
    { method: 'delete', path: `/api/catalog-items/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATITEM-005A' },
    { method: 'patch',  path: `/api/catalog-items/activate/${ UUID }`,  minRole: 'SUPERADMIN', code: 'ESAVI-CATITEM-005B' },

    // catalogType
    { method: 'post',   path: '/api/catalog-types',                     minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-001' },
    { method: 'get',    path: '/api/catalog-types',                     minRole: 'USER',       code: 'ESAVI-CATTYPE-002' },
    { method: 'get',    path: `/api/catalog-types/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-CATTYPE-003' },
    { method: 'put',    path: `/api/catalog-types/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-004' },
    { method: 'delete', path: `/api/catalog-types/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-CATTYPE-005A' },
    { method: 'patch',  path: `/api/catalog-types/activate/${ UUID }`,  minRole: 'SUPERADMIN', code: 'ESAVI-CATTYPE-005B' },

    // geoLevelType
    { method: 'post',   path: '/api/geo-level-types',                    minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-001' },
    { method: 'get',    path: '/api/geo-level-types',                    minRole: 'USER',       code: 'ESAVI-GEOLVL-002' },
    { method: 'get',    path: `/api/geo-level-types/${ UUID }`,          minRole: 'USER',       code: 'ESAVI-GEOLVL-003' },
    { method: 'put',    path: `/api/geo-level-types/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-004' },
    { method: 'delete', path: `/api/geo-level-types/${ UUID }`,          minRole: 'ADMIN',      code: 'ESAVI-GEOLVL-005A' },
    { method: 'patch',  path: `/api/geo-level-types/activate/${ UUID }`, minRole: 'SUPERADMIN', code: 'ESAVI-GEOLVL-005B' },

    // geoLocation
    { method: 'post',   path: '/api/geo-locations',                      minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-001' },
    { method: 'get',    path: '/api/geo-locations',                      minRole: 'USER',       code: 'ESAVI-GEOLOC-002' },
    { method: 'get',    path: `/api/geo-locations/${ UUID }`,            minRole: 'USER',       code: 'ESAVI-GEOLOC-003' },
    { method: 'put',    path: `/api/geo-locations/${ UUID }`,            minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-004' },
    { method: 'delete', path: `/api/geo-locations/${ UUID }`,            minRole: 'ADMIN',      code: 'ESAVI-GEOLOC-005A' },
    { method: 'patch',  path: `/api/geo-locations/activate/${ UUID }`,   minRole: 'SUPERADMIN', code: 'ESAVI-GEOLOC-005B' },

    // healthFacility
    { method: 'post',   path: '/api/health-facilities',                              minRole: 'ADMIN',      code: 'ESAVI-HFAC-001' },
    { method: 'get',    path: `/api/health-facilities/location/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-HFAC-002A' },
    { method: 'get',    path: `/api/health-facilities/admin/location/${ UUID }`,     minRole: 'ADMIN',      code: 'ESAVI-HFAC-002B' },
    { method: 'get',    path: `/api/health-facilities/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-HFAC-003' },
    { method: 'put',    path: `/api/health-facilities/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-HFAC-004' },
    { method: 'delete', path: `/api/health-facilities/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-HFAC-005A' },
    { method: 'patch',  path: `/api/health-facilities/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-HFAC-005B' },

    // appRole
    { method: 'post',   path: '/api/roles',                                           minRole: 'ADMIN',      code: 'ESAVI-APPROLE-001' },
    { method: 'get',    path: '/api/roles',                                           minRole: 'USER',       code: 'ESAVI-APPROLE-002A' },
    { method: 'get',    path: '/api/roles/admin',                                     minRole: 'ADMIN',      code: 'ESAVI-APPROLE-002B' },
    { method: 'get',    path: `/api/roles/${ UUID }`,                                 minRole: 'USER',       code: 'ESAVI-APPROLE-003' },
    { method: 'put',    path: `/api/roles/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-APPROLE-004' },
    { method: 'delete', path: `/api/roles/${ UUID }`,                                 minRole: 'ADMIN',      code: 'ESAVI-APPROLE-005A' },
    { method: 'patch',  path: `/api/roles/activate/${ UUID }`,                        minRole: 'SUPERADMIN', code: 'ESAVI-APPROLE-005B' },

    // appUserGeoLocation
    { method: 'post',   path: '/api/user-geo-locations',                              minRole: 'ADMIN',      code: 'ESAVI-USERGEO-001' },
    { method: 'post',   path: '/api/user-geo-locations/bulk',                         minRole: 'ADMIN',      code: 'ESAVI-USERGEO-007' },
    { method: 'get',    path: `/api/user-geo-locations/user/${ UUID }`,               minRole: 'USER',       code: 'ESAVI-USERGEO-002A' },
    { method: 'get',    path: `/api/user-geo-locations/admin/user/${ UUID }`,         minRole: 'ADMIN',      code: 'ESAVI-USERGEO-002B' },
    { method: 'get',    path: `/api/user-geo-locations/user/${ UUID }/coverage`,      minRole: 'USER',       code: 'ESAVI-USERGEO-008' },
    { method: 'get',    path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'USER',       code: 'ESAVI-USERGEO-003' },
    { method: 'put',    path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-USERGEO-004' },
    { method: 'patch',  path: `/api/user-geo-locations/reassign/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-USERGEO-006' },
    { method: 'delete', path: `/api/user-geo-locations/${ UUID }`,                    minRole: 'ADMIN',      code: 'ESAVI-USERGEO-005A' },
    { method: 'patch',  path: `/api/user-geo-locations/activate/${ UUID }`,           minRole: 'SUPERADMIN', code: 'ESAVI-USERGEO-005B' },

    // appUserRole
    { method: 'post',   path: '/api/user-roles',                          minRole: 'ADMIN',      code: 'ESAVI-USERROLE-001' },
    { method: 'post',   path: '/api/user-roles/bulk',                     minRole: 'ADMIN',      code: 'ESAVI-USERROLE-007' },
    { method: 'get',    path: `/api/user-roles/user/${ UUID }`,           minRole: 'USER',       code: 'ESAVI-USERROLE-002A' },
    { method: 'get',    path: `/api/user-roles/admin/user/${ UUID }`,     minRole: 'ADMIN',      code: 'ESAVI-USERROLE-002B' },
    { method: 'get',    path: `/api/user-roles/role/${ UUID }`,           minRole: 'ADMIN',      code: 'ESAVI-USERROLE-006' },
    { method: 'get',    path: `/api/user-roles/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-USERROLE-003' },
    { method: 'delete', path: `/api/user-roles/${ UUID }`,                minRole: 'ADMIN',      code: 'ESAVI-USERROLE-005A' },
    { method: 'patch',  path: `/api/user-roles/activate/${ UUID }`,       minRole: 'SUPERADMIN', code: 'ESAVI-USERROLE-005B' },

    // user
    { method: 'post',   path: '/api/users',                        minRole: 'ADMIN',      code: 'ESAVI-USER-001' },
    { method: 'get',    path: '/api/users',                        minRole: 'ADMIN',      code: 'ESAVI-USER-002A' },
    { method: 'get',    path: '/api/users/admin',                  minRole: 'ADMIN',      code: 'ESAVI-USER-002B' },
    { method: 'get',    path: '/api/users/me',                     minRole: 'USER',       code: 'ESAVI-USER-007' },
    { method: 'patch',  path: '/api/users/me/password',            minRole: 'USER',       code: 'ESAVI-USER-006' },
    { method: 'get',    path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-003' },
    { method: 'put',    path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-004' },
    { method: 'delete', path: `/api/users/${ UUID }`,              minRole: 'ADMIN',      code: 'ESAVI-USER-005A' },
    { method: 'patch',  path: `/api/users/activate/${ UUID }`,     minRole: 'SUPERADMIN', code: 'ESAVI-USER-005B' },

    // patient — 001 and 004 sit at USER on purpose (SPEC F05 §3.4): whoever reports an
    // ESAVI is operational staff and needs to register the patient who does not exist yet
    { method: 'post',   path: '/api/patients',                          minRole: 'USER',       code: 'ESAVI-PATIENT-001' },
    { method: 'get',    path: '/api/patients',                          minRole: 'USER',       code: 'ESAVI-PATIENT-002A' },
    { method: 'get',    path: '/api/patients/admin',                    minRole: 'ADMIN',      code: 'ESAVI-PATIENT-002B' },
    { method: 'get',    path: `/api/patients/search/${ UUID }`,         minRole: 'USER',       code: 'ESAVI-PATIENT-006' },
    { method: 'get',    path: `/api/patients/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-PATIENT-003' },
    { method: 'put',    path: `/api/patients/${ UUID }`,                minRole: 'USER',       code: 'ESAVI-PATIENT-004' },
    { method: 'delete', path: `/api/patients/${ UUID }`,                minRole: 'ADMIN',      code: 'ESAVI-PATIENT-005A' },
    { method: 'patch',  path: `/api/patients/activate/${ UUID }`,       minRole: 'SUPERADMIN', code: 'ESAVI-PATIENT-005B' }
];

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
            expect(ROUTE_RULES).toHaveLength(74);
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

    });

});
