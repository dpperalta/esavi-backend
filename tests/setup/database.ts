import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/database/connection';
import { initModels } from '../../src/models';
import { ROLES, ROLE_LEVELS } from '../../src/constants/roles.constants';
import { encryptSystemConfigValue } from '../../src/helpers/systemConfigValue.helper';
import { syncSystemConfigDefaultsService } from '../../src/services/systemConfig.service';

const SCHEMA_FILE = 'esaviapp.sql';

/**
 * Guard against running the suite over a non-test database. The setup recreates
 * `DB_NAME` from scratch, so pointing it at `esavi_dev` would destroy it.
 */
const assertTestEnvironment = (): void => {
    if( process.env.NODE_ENV !== 'test' ) {
        throw new Error(
            `The test setup refuses to run with NODE_ENV="${ process.env.NODE_ENV }". ` +
            'Expected "test". Check that jest loads tests/setup/env.ts and that .env.test exists.'
        );
    }

    const dbName = process.env.DB_NAME;

    if( !dbName ) {
        throw new Error(
            'DB_NAME is not set. Copy .env.test.example to .env.test and fill in the local PostgreSQL credentials.'
        );
    }

    if( !dbName.endsWith('_test') ) {
        throw new Error(
            `The test setup refuses to recreate the database "${ dbName }" because its name does not end in "_test". ` +
            'Point DB_NAME in .env.test at a dedicated test database, never at the development one.'
        );
    }
}

/**
 * Opens a connection to the maintenance database, which must be a different one
 * from the database being dropped.
 */
const connectToMaintenanceDatabase = async (): Promise<Client> => {
    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_MAINTENANCE_NAME || 'postgres'
    });

    try {
        await client.connect();
    } catch (error) {
        throw new Error(
            'Cannot reach PostgreSQL. The suite needs a running server and the credentials in .env.test. ' +
            `Original error: ${ error instanceof Error ? error.message : String(error) }`
        );
    }

    return client;
}

/**
 * Drops and recreates `DB_NAME`, so every run starts from an empty database.
 */
const recreateTestDatabase = async (): Promise<void> => {
    const dbName = process.env.DB_NAME as string;
    const client = await connectToMaintenanceDatabase();

    try {
        await client.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [dbName]
        );
        await client.query(`DROP DATABASE IF EXISTS "${ dbName }"`);
        await client.query(`CREATE DATABASE "${ dbName }"`);
    } finally {
        await client.end();
    }
}

/**
 * Loads the authoritative DDL. The schema is never created by Sequelize:
 * `esaviapp.sql` is the single source of truth and already wraps itself in a
 * transaction, so it runs as one batch.
 */
const loadSchema = async (): Promise<void> => {
    const schemaPath = path.resolve(process.cwd(), SCHEMA_FILE);

    if( !fs.existsSync(schemaPath) ) {
        throw new Error(`Cannot find ${ SCHEMA_FILE } at the repository root. It holds the authoritative schema.`);
    }

    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    await client.connect();

    try {
        // esaviapp.sql declares pgcrypto and citext, but uses geometry(MultiPolygon, 4326)
        // in "geoLocation" without declaring PostGIS. A freshly created database has to
        // enable it before the DDL runs.
        await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
        await client.query(fs.readFileSync(schemaPath, 'utf8'));
    } finally {
        await client.end();
    }
}

/**
 * Seeds the four canonical roles. `validateUserRole` resolves a user's level by
 * uppercasing `appRole.name` and looking it up in `ROLE_LEVELS`, so `name` has
 * to match the constant exactly.
 */
const seedRoles = async (): Promise<void> => {
    const roles = [
        { code: ROLES.SUPERADMIN, name: ROLES.SUPERADMIN, description: 'Test superadmin role' },
        { code: ROLES.ADMIN,      name: ROLES.ADMIN,      description: 'Test admin role' },
        { code: ROLES.USER,       name: ROLES.USER,       description: 'Test user role' },
        { code: ROLES.ANALYTICS,  name: ROLES.ANALYTICS,  description: 'Test analytics role' }
    ];

    for( const role of roles ) {
        await sequelize.query(
            `INSERT INTO "appRole" ("code", "name", "description", "level", "isSystemRole", "isActive")
             VALUES (:code, :name, :description, :level, true, true)
             ON CONFLICT ("code") DO NOTHING`,
            {
                replacements: {
                    code: role.code,
                    name: role.name,
                    description: role.description,
                    level: ROLE_LEVELS[role.code]
                },
                type: QueryTypes.INSERT
            }
        );
    }
}


/**
 * Seeds the configuration catalogue and loads the eight values SPEC F43 reads at runtime.
 *
 * TWO STEPS, AND THE ORDER MATTERS. First the real ESAVI-SYSCONF-008, so every row is created the
 * way production creates it — with its history row and its audit entry, which is what
 * `tests/contract/systemConfig.test.ts` asserts about rows an earlier suite may have seeded.
 * Then the eight values of SPEC F43 are written with a silent update: the declarative catalogue
 * seeds the six MAIL rows EMPTY on purpose — they are credentials and `systemConfig.defaults.ts`
 * is versioned in git — so without this the 006 would have no transport and no expiry. The update
 * is silent, and never the 004, so it leaves no history row behind and the seeding assertions of
 * that other suite keep seeing exactly one entry with a null previousValue.
 *
 * Loading them into the DATABASE and not into the environment is deliberate: it is what makes the
 * precedence of §3.6 — the database wins, the environment is the fallback — assertable.
 *
 * The SMTP host is never dialled: under NODE_ENV=test `buildMailTransport` returns
 * `jsonTransport`, which serialises the message without opening a connection.
 */
const seedSystemConfig = async (): Promise<void> => {
    await syncSystemConfigDefaultsService(undefined, 'es');

    const values: { code: string; scope: string; value: unknown; isEncrypted: boolean }[] = [
        { code: 'ESAVI_MAIL_SMTP_HOST',     scope: 'MAIL', value: 'smtp.test.local',          isEncrypted: false },
        { code: 'ESAVI_MAIL_SMTP_USER',     scope: 'MAIL', value: 'esavi-test',               isEncrypted: false },
        { code: 'ESAVI_MAIL_SMTP_PASSWORD', scope: 'MAIL', value: 'test-smtp-password',       isEncrypted: true  },
        { code: 'ESAVI_MAIL_FROM',          scope: 'MAIL', value: 'no-reply@esavi.test',      isEncrypted: false },
        { code: 'ESAVI_PASSWORD_RESET_URL', scope: 'AUTH', value: 'https://esavi.test/reset', isEncrypted: false }
    ];

    for( const entry of values ) {
        const stored = entry.isEncrypted ? encryptSystemConfigValue(entry.value) : entry.value;
        await sequelize.query(
            `UPDATE "systemConfig" SET "value" = CAST(:value AS jsonb)
             WHERE "code" = :code AND "scope" = :scope`,
            {
                replacements: { value: JSON.stringify(stored), code: entry.code, scope: entry.scope },
                type: QueryTypes.UPDATE
            }
        );
    }
}

/**
 * Full setup: guard, recreate, load schema, seed and register the models.
 * Called once from Jest's `globalSetup`-equivalent entry in each suite.
 */
const setupTestDatabase = async (): Promise<void> => {
    assertTestEnvironment();
    await recreateTestDatabase();
    await loadSchema();

    initModels();
    await sequelize.authenticate();
    await seedRoles();
    await seedSystemConfig();
}

let modelsReady = false;

/**
 * Per-file entry point. Jest gives every test file its own module registry, so
 * each one has to register the models and open its own pool over the database
 * that `globalSetup` already recreated. Idempotent: registering the
 * associations twice would make Sequelize redefine them.
 */
const openTestConnection = async (): Promise<void> => {
    assertTestEnvironment();

    if( !modelsReady ) {
        initModels();
        modelsReady = true;
    }

    await sequelize.authenticate();
}

/**
 * Closes the pool so Jest exits without open handles.
 */
const closeTestDatabase = async (): Promise<void> => {
    await sequelize.close();
}

export {
    assertTestEnvironment,
    recreateTestDatabase,
    loadSchema,
    seedRoles,
    seedSystemConfig,
    setupTestDatabase,
    openTestConnection,
    closeTestDatabase
}
