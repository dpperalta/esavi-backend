import request from 'supertest';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, Patient } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader, getTestUser } from '../setup/auth';
import type { TestRole } from '../setup/auth';

/**
 * SPEC F59: appDetails[].user stores a userId and answers the author's email to ADMIN and
 * SUPERADMIN, null to everyone else, and never the UUID. healthFacility is the reference entity;
 * the sweep at the end samples a 003 and a list per family of the inventory.
 */
describe('appDetails authors contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const resolutionQuery = /FROM "appUser".*"userId" IN \(/s;

    let geoLocationId: string;
    let consoleError: jest.SpyInstance;

    // Walks a response body and fails on any appDetails[].user that is a UUID, at any depth
    const expectNoAuditUuids = (value: unknown, where: string = 'body'): void => {
        if( Array.isArray(value) ) {
            value.forEach((item, index) => expectNoAuditUuids(item, `${ where }[${ index }]`));
            return;
        }
        if( value === null || typeof value !== 'object' ) {
            return;
        }
        for( const [ key, child ] of Object.entries(value) ) {
            if( key === 'appDetails' && Array.isArray(child) ) {
                for( const entry of child ) {
                    const user = (entry as { user?: unknown }).user;
                    if( typeof user === 'string' && uuidPattern.test(user) ) {
                        throw new Error(`UUID exposed in ${ where }.appDetails: ${ user }`);
                    }
                }
                continue;
            }
            expectNoAuditUuids(child, `${ where }.${ key }`);
        }
    };

    // Counts the author-resolution queries a request runs. tokenValidation also reads appUser,
    // but by equality, never with an IN
    const countResolutionQueries = async <T>(run: () => Promise<T>): Promise<{ result: T; count: number }> => {
        const spy = jest.spyOn(sequelize, 'query');
        try {
            const result = await run();
            const count = spy.mock.calls.filter(([ sql ]) => typeof sql === 'string' && resolutionQuery.test(sql)).length;
            return { result, count };
        } finally {
            spy.mockRestore();
        }
    };

    const post = (url: string, payload: Record<string, unknown>, role: TestRole = 'ADMIN') =>
        request(app).post(url).set(authHeader(role)).send(payload);

    const get = (url: string, role: TestRole) =>
        request(app).get(url).set(authHeader(role));

    const createFacility = async (label: string, role: TestRole = 'ADMIN'): Promise<string> => {
        const response = await post('/api/health-facilities', { geoLocationId, name: `${ label } ${ suffix }` }, role);
        expect(response.status).toBe(201);
        return response.body.data.healthFacilityId;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const levelResponse = await post('/api/geo-level-types', { code: `authorsLevel${ suffix }`, name: `Authors Level ${ suffix }`, sortOrder: 1 });
        expect(levelResponse.status).toBe(201);
        const locationResponse = await post('/api/geo-locations', {
            geoLevelTypeId: levelResponse.body.data.geoLevelTypeId,
            name: `Authors Location ${ suffix }`,
            externalCode: `AUTHORS${ suffix }`
        });
        expect(locationResponse.status).toBe(201);
        geoLocationId = locationResponse.body.data.geoLocationId;
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('reference entity — healthFacility', () => {

        let healthFacilityId: string;

        beforeAll(async () => {
            healthFacilityId = await createFacility('Authors Reference');
        });

        it('a 003 read by ADMIN answers the author as the decrypted email', async () => {
            const response = await get(`/api/health-facilities/${ healthFacilityId }`, 'ADMIN');

            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0]).toEqual(expect.objectContaining({
                method: 'ESAVI-HFAC-001',
                user: getTestUser('ADMIN').email
            }));
        });

        it('a 003 read by USER answers null and runs no resolution query', async () => {
            const { result: response, count } = await countResolutionQueries(() =>
                get(`/api/health-facilities/${ healthFacilityId }`, 'USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.appDetails[0].user).toBeNull();
            expect(count).toBe(0);
        });

        it('SUPERADMIN sees the email as ADMIN does', async () => {
            const response = await get(`/api/health-facilities/${ healthFacilityId }`, 'SUPERADMIN');

            expect(response.body.data.appDetails[0].user).toBe(getTestUser('ADMIN').email);
        });

        it('the list answers the email to ADMIN and null to USER, in every row', async () => {
            const asAdmin = await get(`/api/health-facilities/location/${ geoLocationId }`, 'ADMIN');
            const asUser = await get(`/api/health-facilities/location/${ geoLocationId }`, 'USER');

            expect(asAdmin.status).toBe(200);
            expect(asAdmin.body.data.rows.length).toBeGreaterThan(0);
            for( const row of asAdmin.body.data.rows ) {
                expect(row.appDetails[0].user).toBe(getTestUser('ADMIN').email);
            }
            for( const row of asUser.body.data.rows ) {
                expect(row.appDetails[0].user).toBeNull();
            }
        });

        it('a list of N rows by several authors runs exactly one resolution query', async () => {
            await createFacility('Authors Second');
            await createFacility('Authors Third', 'SUPERADMIN');

            const { result: response, count } = await countResolutionQueries(() =>
                get(`/api/health-facilities/location/${ geoLocationId }`, 'ADMIN'));

            const authors = new Set(response.body.data.rows.map((row: { appDetails: { user: string }[] }) => row.appDetails[0].user));
            expect(response.body.data.rows.length).toBeGreaterThanOrEqual(3);
            expect(authors).toEqual(new Set([ getTestUser('ADMIN').email, getTestUser('SUPERADMIN').email ]));
            expect(count).toBe(1);
        });

        it('the 001 and a real 004 already answer the email to the ADMIN who writes', async () => {
            const created = await post('/api/health-facilities', { geoLocationId, name: `Authors Write ${ suffix }` });
            expect(created.body.data.appDetails[0].user).toBe(getTestUser('ADMIN').email);

            const updated = await request(app)
                .put(`/api/health-facilities/${ created.body.data.healthFacilityId }`)
                .set(authHeader('ADMIN'))
                .send({ name: `Authors Write Renamed ${ suffix }` });

            expect(updated.status).toBe(200);
            expect(updated.body.data.appDetails.map((entry: { user: string }) => entry.user))
                .toEqual([ getTestUser('ADMIN').email, getTestUser('ADMIN').email ]);
        });

        it('the stored value is still the userId', async () => {
            const row = await HealthFacility.findByPk(healthFacilityId);
            const stored = row!.getDataValue('appDetails') as { user: string }[];

            expect(stored[0].user).toBe(getTestUser('ADMIN').userId);
        });

        it('literal authors and unknown UUIDs answer null, with 200 and not 500', async () => {
            const row = await HealthFacility.findByPk(healthFacilityId);
            const current = row!.getDataValue('appDetails') as object[];
            const createdAt = new Date().toISOString();
            await sequelize.query(
                'UPDATE "healthFacility" SET "appDetails" = :appDetails::jsonb WHERE "healthFacilityId" = :id',
                {
                    replacements: {
                        id: healthFacilityId,
                        appDetails: JSON.stringify([
                            ...current,
                            { createdAt, user: 'undefined', method: 'ESAVI-TEST-001', detail: 'Written without authUser' },
                            { createdAt, user: 'unknown', method: 'ESAVI-TEST-001', detail: 'Written without authUser' },
                            { createdAt, user: '00000000-0000-4000-8000-000000000000', method: 'ESAVI-TEST-001', detail: 'No such user' }
                        ])
                    }
                }
            );

            const response = await get(`/api/health-facilities/${ healthFacilityId }`, 'ADMIN');

            expect(response.status).toBe(200);
            const users = response.body.data.appDetails.map((entry: { user: string | null }) => entry.user);
            expect(users[0]).toBe(getTestUser('ADMIN').email);
            expect(users.slice(-3)).toEqual([ null, null, null ]);
        });
    });

    describe('sweep — no UUID in any family', () => {

        const expectClean = async (url: string) => {
            for( const role of [ 'ADMIN', 'USER' ] as TestRole[] ) {
                const response = await get(url, role);
                expect(response.status).toBe(200);
                expectNoAuditUuids(response.body);
            }
        };

        let catalogTypeId: string;
        let geoLevelTypeId: string;
        let roleId: string;
        let patientId: string;
        let investigationId: string;
        let teamMemberId: string;

        beforeAll(async () => {
            catalogTypeId = (await post('/api/catalog-types', { name: `authors sweep ${ suffix }` })).body.data.catalogTypeId;
            geoLevelTypeId = (await post('/api/geo-level-types', { code: `sweepLevel${ suffix }`, name: `Sweep Level ${ suffix }`, sortOrder: 2 })).body.data.geoLevelTypeId;
            roleId = (await post('/api/roles', { code: `SWEEP_${ suffix }`, name: `SWEEP_${ suffix }`, description: 'Sweep role', level: 20 })).body.data.roleId;

            const patient = await post('/api/patients', {
                names: 'sweep',
                lastNames: 'authors',
                birthDate: '1990-01-01',
                documentNumber: `SW${ suffix }`
            }, 'USER');
            patientId = patient.body.data.patientId;

            const facility = await HealthFacility.create({ localCode: `SW${ suffix }`, name: `Sweep ${ suffix }` });
            const caseRow = await EsaviCase.create({
                patientId: (await Patient.create({
                    names: esaviCrypt('Sweep'),
                    lastNames: esaviCrypt(`Case ${ suffix }`),
                    documentNumber: esaviCrypt(`SC${ suffix }`),
                    healthSystemCode: `SC${ suffix }`,
                    birthDate: '2000-05-04'
                })).getDataValue('patientId'),
                healthFacilityId: facility.getDataValue('healthFacilityId'),
                caseCode: `SW-${ suffix }`,
                reportDate: new Date().toISOString().slice(0, 10),
                eventDate: '2024-05-04'
            });
            const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
            const statusZero = await CatalogItem.findOne({ where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '0' } });
            investigationId = (await Investigation.create({
                caseId: caseRow.getDataValue('caseId'),
                statusItemId: statusZero!.getDataValue('catalogItemId')
            })).getDataValue('investigationId');
            teamMemberId = (await post('/api/investigation-team-members', { investigationId, fullName: 'Sweep Member' }, 'USER')).body.data.investigationTeamMemberId;

            for( const id of [ catalogTypeId, geoLevelTypeId, roleId, patientId, teamMemberId ] ) {
                expect(id).toEqual(expect.stringMatching(uuidPattern));
            }
        });

        it('catalogs — catalogType 002A and 003', async () => {
            await expectClean('/api/catalog-types');
            await expectClean(`/api/catalog-types/${ catalogTypeId }`);
        });

        it('geography — geoLevelType 002A and 003', async () => {
            await expectClean('/api/geo-level-types');
            await expectClean(`/api/geo-level-types/${ geoLevelTypeId }`);
        });

        it('users and roles — appRole 002A and 003', async () => {
            await expectClean('/api/roles');
            await expectClean(`/api/roles/${ roleId }`);
        });

        it('patient and case — patient 002A and 003', async () => {
            await expectClean('/api/patients');
            await expectClean(`/api/patients/${ patientId }`);
        });

        it('investigation — investigationTeamMember list and 003', async () => {
            await expectClean(`/api/investigation-team-members/investigation/${ investigationId }`);
            await expectClean(`/api/investigation-team-members/${ teamMemberId }`);
        });

        it('the sampled 003 of each family did carry a resolved author for ADMIN', async () => {
            for( const url of [
                `/api/catalog-types/${ catalogTypeId }`,
                `/api/geo-level-types/${ geoLevelTypeId }`,
                `/api/roles/${ roleId }`,
                `/api/patients/${ patientId }`,
                `/api/investigation-team-members/${ teamMemberId }`
            ] ) {
                const response = await get(url, 'ADMIN');
                const authors = (response.body.data.appDetails as { user: string | null }[]).map(entry => entry.user);
                expect(authors.some(user => typeof user === 'string' && user.endsWith('@test.local'))).toBe(true);
            }
        });
    });
});
