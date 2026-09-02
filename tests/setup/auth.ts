import bcrypt from 'bcrypt';
import { AppUser, AppRole, AppUserRole, AppUserGeoLocation } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { jwtGenerate } from '../../src/helpers/jwt.helper';
import { ROLES } from '../../src/constants/roles.constants';
import { openTestConnection } from './database';

type TestRole = keyof typeof ROLES;

interface TestUser {
    userId: string;
    email: string;
    password: string;
    token: string;
    role: TestRole;
}

const TEST_ROLES: TestRole[] = ['SUPERADMIN', 'ADMIN', 'USER', 'ANALYTICS'];
const TEST_PASSWORD = 'TestPassword123!';

const testUsers = new Map<TestRole, TestUser>();

/**
 * Creates one user for the given role and assigns it. PII goes through
 * `esaviCrypt` because that is how the application stores and looks it up;
 * a plaintext email here would make `loginService` unable to find the user.
 *
 * Idempotent by design: Jest gives every test file its own module registry, so
 * the in-memory cache resets per file while the rows survive the whole run.
 * Creating blindly would hit `UQ_appUser_email` on the second file.
 */
const createTestUser = async ( role: TestRole ): Promise<TestUser> => {
    const email = `${ role.toLowerCase() }@test.local`;
    const displayName = `Test ${ role }`;

    const appRole = await AppRole.findOne({ where: { code: ROLES[role] } });

    if( !appRole ) {
        throw new Error(
            `The role "${ ROLES[role] }" is not seeded. tests/setup/database.ts must run before issuing tokens.`
        );
    }

    const [user] = await AppUser.findOrCreate({
        where: { email: esaviCrypt(email) },
        defaults: {
            username: esaviCrypt(email),
            email: esaviCrypt(email),
            passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
            displayName: esaviCrypt(displayName),
            requiresPasswordChange: false,
            isActive: true
        }
    });

    await AppUserRole.findOrCreate({
        where: {
            userId: user.getDataValue('userId'),
            roleId: appRole.getDataValue('roleId')
        },
        defaults: {
            userId: user.getDataValue('userId'),
            roleId: appRole.getDataValue('roleId'),
            isActive: true
        }
    });

    const token = await jwtGenerate({ userId: user.getDataValue('userId') }) as string;

    return {
        userId: user.getDataValue('userId'),
        email,
        password: TEST_PASSWORD,
        token,
        role
    };
}

/**
 * Creates the four users once and memoizes them. Tokens are minted directly
 * instead of going through `POST /auth/login`, so a regression in the login
 * endpoint fails only its own test rather than the whole suite.
 */
const seedTestUsers = async (): Promise<Map<TestRole, TestUser>> => {
    await openTestConnection();

    for( const role of TEST_ROLES ) {
        if( !testUsers.has(role) ) {
            testUsers.set(role, await createTestUser(role));
        }
    }

    return testUsers;
}

const getTestUser = ( role: TestRole ): TestUser => {
    const user = testUsers.get(role);

    if( !user ) {
        throw new Error(`No test user for role "${ role }". Call seedTestUsers() in a beforeAll hook.`);
    }

    return user;
}

const scopedTestUsers = new Map<string, TestUser>();

/**
 * Creates a USER-role user separate from the one `seedTestUsers` shares across every
 * test file, and assigns it a geoLocationId in `appUserGeoLocation` — SPEC F49's
 * territorial scope. Kept apart from the shared default USER so a test file can give
 * it real territory without touching the account other files' suites (notably
 * appUserGeoLocation.test.ts, which counts assignments of the shared USER) rely on.
 *
 * Memoized by `key` per module registry, same idempotency rationale as createTestUser:
 * findOrCreate on email avoids UQ_appUser_email across files that reuse the same key.
 *
 * `geoLocationId` null creates the user without any appUserGeoLocation row — SPEC F49's
 * empty scope, on a user nobody else's suite can have already touched.
 */
const createScopedTestUser = async ( key: string, geoLocationId: string | null ): Promise<TestUser> => {
    if( scopedTestUsers.has(key) ) return scopedTestUsers.get(key) as TestUser;

    const email = `scoped-${ key }@test.local`;
    const displayName = `Scoped ${ key }`;

    const appRole = await AppRole.findOne({ where: { code: ROLES.USER } });
    if( !appRole ) {
        throw new Error('The role "USER" is not seeded. tests/setup/database.ts must run before issuing tokens.');
    }

    const [user] = await AppUser.findOrCreate({
        where: { email: esaviCrypt(email) },
        defaults: {
            username: esaviCrypt(email),
            email: esaviCrypt(email),
            passwordHash: await bcrypt.hash(TEST_PASSWORD, 10),
            displayName: esaviCrypt(displayName),
            requiresPasswordChange: false,
            isActive: true
        }
    });

    const userId = user.getDataValue('userId');

    await AppUserRole.findOrCreate({
        where: { userId, roleId: appRole.getDataValue('roleId') },
        defaults: { userId, roleId: appRole.getDataValue('roleId'), isActive: true }
    });

    if( geoLocationId ) {
        await AppUserGeoLocation.findOrCreate({
            where: { userId, geoLocationId },
            defaults: { userId, geoLocationId, validFrom: new Date(), isActive: true }
        });
    }

    const token = await jwtGenerate({ userId }) as string;

    const scopedUser: TestUser = { userId, email, password: TEST_PASSWORD, token, role: 'USER' };
    scopedTestUsers.set(key, scopedUser);
    return scopedUser;
}

const getToken = ( role: TestRole ): string => getTestUser(role).token;

/**
 * Ready-made `Authorization` header, so tests read as
 * `.set(authHeader('ADMIN'))` instead of repeating the Bearer prefix.
 */
const authHeader = ( role: TestRole ): Record<string, string> => ({
    Authorization: `Bearer ${ getToken(role) }`
});

export {
    TEST_ROLES,
    TEST_PASSWORD,
    seedTestUsers,
    getTestUser,
    getToken,
    authHeader,
    createScopedTestUser
}

export type {
    TestRole,
    TestUser
}
