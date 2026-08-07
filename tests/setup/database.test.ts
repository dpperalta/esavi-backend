import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/database/connection';
import { ROLES } from '../../src/constants/roles.constants';
import { assertTestEnvironment, closeTestDatabase } from './database';

describe('test database setup', () => {

    afterAll(async () => {
        await closeTestDatabase();
    });

    it('points at a dedicated test database', () => {
        expect(process.env.NODE_ENV).toBe('test');
        expect(process.env.DB_NAME).toMatch(/_test$/);
        expect(() => assertTestEnvironment()).not.toThrow();
    });

    it('refuses to run outside NODE_ENV=test', () => {
        const original = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';

        expect(() => assertTestEnvironment()).toThrow(/NODE_ENV/);

        process.env.NODE_ENV = original;
    });

    it('refuses to recreate a database whose name does not end in _test', () => {
        const original = process.env.DB_NAME;
        process.env.DB_NAME = 'esavi_dev';

        expect(() => assertTestEnvironment()).toThrow(/_test/);

        process.env.DB_NAME = original;
    });

    it('loaded the schema from esaviapp.sql', async () => {
        const tables = await sequelize.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'`,
            { type: QueryTypes.SELECT }
        );

        expect(Number(tables[0].count)).toBeGreaterThan(30);
    });

    // Scoped to the four canonical names rather than the whole table: since SPEC F03 gave
    // appRole a CRUD, the contract suites create roles of their own that survive the run
    it('seeded the four canonical roles', async () => {
        const roles = await sequelize.query<{ name: string; level: number }>(
            `SELECT "name", "level" FROM "appRole" WHERE "name" IN (:names) ORDER BY "level" DESC`,
            {
                replacements: { names: [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.USER, ROLES.ANALYTICS] },
                type: QueryTypes.SELECT
            }
        );

        expect(roles.map(role => role.name)).toEqual([
            ROLES.SUPERADMIN,
            ROLES.ADMIN,
            ROLES.USER,
            ROLES.ANALYTICS
        ]);
        expect(roles.map(role => role.level)).toEqual([100, 50, 25, 10]);
    });

});
