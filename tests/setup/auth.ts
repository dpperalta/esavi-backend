import bcrypt from 'bcrypt';
import { AppUser, AppRole, AppUserRole } from '../../src/models';
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

const getToken = ( role: TestRole ): string => getTestUser(role).token;

/**
 * Ready-made `Authorization` header, so tests read as
 * `.set(authHeader('ADMIN'))` instead of repeating the Bearer prefix.
 */
const authHeader = ( role: TestRole ): { Authorization: string } => ({
    Authorization: `Bearer ${ getToken(role) }`
});

export {
    TEST_ROLES,
    TEST_PASSWORD,
    seedTestUsers,
    getTestUser,
    getToken,
    authHeader
}

export type {
    TestRole,
    TestUser
}
