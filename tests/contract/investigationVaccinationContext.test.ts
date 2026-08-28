import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationVaccinationContext, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationVaccinationContext operations of SPEC F36. It walks
 * the entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the logical
 * seal does not release but the purge does, the three distinct 404 of the access by case, and
 * the cluster block evaluated over the resulting state.
 *
 * Three things separate this entity from its sisters F29, F30, F32 and F34 and get deliberate
 * coverage:
 *
 *  - It is the FIRST conditional block of the repository governed by an answerOption instead of
 *    a boolean. isCluster has five values, so the "no" has FIVE forms — 'NO', 'UNKNOWN',
 *    'NOT_APPLICABLE', 'NO_ANSWER' and null — and ONLY 'YES' opens the block. A rule written as
 *    "only 'NO' closes it" would pass the 'NO' case and let cluster data in under the other
 *    three, which is the main risk the spec declares, so the five forms are exercised one by one.
 *  - The block has NO mandatory side: with isCluster 'YES' the four fields stay optional. The
 *    rule is one of prohibition only.
 *  - It is the first entity with TWO foreign keys resolved against ONE catalog. Both aliases must
 *    resolve DIFFERENT objects, which is a silent failure: a row holding the same item in both
 *    columns would look correct either way, so the case uses two different items on purpose.
 *
 * The 0 gets deliberate coverage of its own on the four counters: a truthiness check in the
 * service would throw it away, and "nobody else was vaccinated from that vial" would become
 * inexpressible while still answering 201.
 */
describe('investigationVaccinationContext contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-vaccination-contexts';
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

    let statusZeroItemId: string;
    let firstHoursItemId: string;
    let lastHoursItemId: string;
    let unknownMomentItemId: string;
    let foreignCatalogItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // Every fixture is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Context ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`VC${ counter }${ suffix }`),
            healthSystemCode: `VC${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `VC${ counter }${ suffix }`,
            name: `Context ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `VC-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    // statusItemId is passed explicitly: an investigation created straight through the model
    // skips the service of F28 that resolves the default status, and its `status` would come
    // back null — which this suite asserts never happens
    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> =>
        await createInvestigationForCase(await createCaseFixture(), isActive);

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    // The empty create of this entity: { investigationId } is the whole minimum. Mints an
    // investigation and its vaccination context in one go
    const seed = async (payload: Record<string, unknown> = {}): Promise<string> => {
        const investigationId = await createInvestigationFixture();
        const res = await create({ investigationId, ...payload });
        expect(res.status).toBe(201);
        return investigationId;
    };

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`${ basePath }${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`${ basePath }/admin${ query }`).set(authHeader(role));

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const readRow = async (id: string) => await InvestigationVaccinationContext.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationVaccinationContext.update({ deletedAt: at }, { where: { investigationId } });

    // The eleven data columns of the DDL, all nullable and none of them required
    const dataColumns = [
        'momentItemId', 'multidoseItemId', 'vaccinatedPerVialCount', 'vaccinatedPerBatchCount',
        'locations', 'isCluster', 'clusterIdentificationNumber', 'clusterAdditionalCaseCount',
        'clusterUsedSameVial', 'clusterSameVialCount'
    ];

    // The four fields the cluster block governs, in the order CLUSTER_BLOCK_FIELDS declares them
    const clusterBlockFields: [string, unknown][] = [
        ['clusterIdentificationNumber', 'C-1'],
        ['clusterAdditionalCaseCount', 3],
        ['clusterUsedSameVial', 'YES'],
        ['clusterSameVialCount', 2]
    ];

    // The five forms of the "no". Every one of them CLOSES the block — only 'YES' opens it
    const closingIsClusterValues = ['NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER', null];

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const itemOf = async (typeCode: string, itemCode: string): Promise<string> => {
            const type = await CatalogType.findOne({ where: { code: typeCode } });
            const item = await CatalogItem.findOne({
                where: { catalogTypeId: type!.getDataValue('catalogTypeId'), code: itemCode }
            });
            return item!.getDataValue('catalogItemId');
        };

        // vaccinationMoment and sex are two of the 13 catalogs SPEC F46 found seeded with a numeric
        // code, so their items are resolved by value and not by itemOf's code
        const itemOfValue = async (typeCode: string, itemValue: string): Promise<string> => {
            const item = await CatalogItem.findOne({
                where: { value: itemValue },
                include: [{ model: CatalogType, as: 'catalogType', where: { code: typeCode }, attributes: [] }]
            });
            return item!.getDataValue('catalogItemId');
        };

        // investigationStatus keeps a numeric code, '0' to '5', so this still resolves by it
        statusZeroItemId = await itemOf('investigationStatus', '0');

        // The three items SPEC F36 step 1 seeds in the DDL. If these throw, the seeding did not
        // reach the schema and every POST carrying a moment would answer 404
        firstHoursItemId = await itemOfValue('vaccinationMoment', 'FIRST_HOURS');
        lastHoursItemId = await itemOfValue('vaccinationMoment', 'LAST_HOURS');
        unknownMomentItemId = await itemOfValue('vaccinationMoment', 'UNKNOWN');

        // An ACTIVE item of a different catalog. It is what proves the double hop is implemented
        // and not merely the existence of the UUID
        foreignCatalogItemId = await itemOfValue('sex', 'FEMALE');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('the empty create returns 201 with the eleven data columns in null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            for( const column of dataColumns ) {
                expect(res.body.data[column]).toBeNull();
            }
            expect(res.body.data.notes).toBeNull();
            expect(res.body.data.investigationId).toBe(investigationId);
        });

        it('does not return isActive nor sysDetails: the table has no activity flag', async () => {
            const investigationId = await seed();
            const res = await create({ investigationId: await createInvestigationFixture() });

            expect(res.body.data.isActive).toBeUndefined();
            expect(res.body.data.sysDetails).toBeUndefined();
            expect(res.body.data.investigation.sysDetails).toBeUndefined();
            expect(res.body.data.deletedAt).toBeNull();
            expect((await readRow(investigationId))!.getDataValue('deletedAt')).toBeNull();
        });

        it('records the operation code in appDetails', async () => {
            const investigationId = await seed();
            const appDetails = (await readRow(investigationId))!.getDataValue('appDetails') as { method: string }[];

            expect(appDetails).toHaveLength(1);
            expect(appDetails[0].method).toBe('ESAVI-INVVACTX-001');
        });

        it('an investigation that does not exist returns 404', async () => {
            const res = await create({ investigationId: '00000000-0000-4000-8000-000000000000' });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_001_INVESTIGATION_NOT_FOUND');
        });

        it('an inactive investigation returns 404', async () => {
            const investigationId = await createInvestigationFixture(false);
            const res = await create({ investigationId });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_001_INVESTIGATION_NOT_FOUND');
        });

        it('creating twice over the same investigation returns 409 with the investigationId interpolated', async () => {
            const investigationId = await seed();
            const res = await create({ investigationId });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVVACTX_001_ALREADY_EXISTS');
            expect(res.body.message).toContain(investigationId);
        });

        it('a sealed row still occupies the investigationId: the logical seal does not free the slot', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await create({ investigationId });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVVACTX_001_ALREADY_EXISTS');
        });

        describe('the cluster block', () => {

            it.each(closingIsClusterValues)('isCluster %p closes the block: a cluster field returns 400', async (value) => {
                const investigationId = await createInvestigationFixture();
                const payload: Record<string, unknown> = { investigationId, clusterIdentificationNumber: 'C-1' };
                if( value !== null ) payload.isCluster = value;

                const res = await create(payload);

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_001_CLUSTER_FIELDS_NOT_ALLOWED');
            });

            it.each(clusterBlockFields)('the four fields produce the same error code: %s', async (field, value) => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'NO', [field]: value });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_001_CLUSTER_FIELDS_NOT_ALLOWED');
            });

            it('isCluster YES with no cluster field at all returns 201: the open block requires nothing', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'YES' });

                expect(res.status).toBe(201);
                expect(res.body.data.isCluster).toBe('YES');
                expect(res.body.data.clusterIdentificationNumber).toBeNull();
            });

            it('isCluster YES stores the four fields as they arrive', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    isCluster: 'YES',
                    clusterIdentificationNumber: '  C-42  ',
                    clusterAdditionalCaseCount: 3,
                    clusterUsedSameVial: 'YES',
                    clusterSameVialCount: 2
                });

                expect(res.status).toBe(201);
                expect(res.body.data.clusterIdentificationNumber).toBe('C-42');
                expect(res.body.data.clusterAdditionalCaseCount).toBe(3);
                expect(res.body.data.clusterUsedSameVial).toBe('YES');
                expect(res.body.data.clusterSameVialCount).toBe(2);
            });

            it('a cluster field sent as null is never an offence, even with the block closed', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'NO', clusterIdentificationNumber: null });

                expect(res.status).toBe(201);
                expect(res.body.data.clusterIdentificationNumber).toBeNull();
            });
        });

        describe('the shared vial rule', () => {

            it('isCluster YES and clusterUsedSameVial NO without the counter returns 400', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'YES', clusterUsedSameVial: 'NO' });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_001_CLUSTER_SAME_VIAL_COUNT_REQUIRED');
            });

            it('the same body with clusterSameVialCount 0 returns 201: the zero satisfies the obligation', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'YES', clusterUsedSameVial: 'NO', clusterSameVialCount: 0 });

                expect(res.status).toBe(201);
                expect(res.body.data.clusterSameVialCount).toBe(0);
            });

            it('isCluster YES and clusterUsedSameVial YES without the counter returns 201', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'YES', clusterUsedSameVial: 'YES' });

                expect(res.status).toBe(201);
                expect(res.body.data.clusterSameVialCount).toBeNull();
            });

            it('the closed block wins over the vial rule: NO plus NO is CLUSTER_FIELDS_NOT_ALLOWED', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isCluster: 'NO', clusterUsedSameVial: 'NO' });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_001_CLUSTER_FIELDS_NOT_ALLOWED');
            });
        });

        describe('the two catalog foreign keys', () => {

            it('an active item of ANOTHER catalog in momentItemId returns 404 momentNotFound', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, momentItemId: foreignCatalogItemId });

                expect(res.status).toBe(404);
                expect(res.body.code).toBe('INVVACTX_001_MOMENT_NOT_FOUND');
            });

            it('the same UUID in multidoseItemId returns multidoseNotFound, a different code', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, multidoseItemId: foreignCatalogItemId });

                expect(res.status).toBe(404);
                expect(res.body.code).toBe('INVVACTX_001_MULTIDOSE_NOT_FOUND');
            });

            it('an item that does not exist returns 404', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, momentItemId: '00000000-0000-4000-8000-000000000000' });

                expect(res.status).toBe(404);
                expect(res.body.code).toBe('INVVACTX_001_MOMENT_NOT_FOUND');
            });

            it('an INACTIVE item of vaccinationMoment returns 404', async () => {
                await CatalogItem.update({ isActive: false }, { where: { catalogItemId: unknownMomentItemId } });
                try {
                    const investigationId = await createInvestigationFixture();
                    const res = await create({ investigationId, momentItemId: unknownMomentItemId });

                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVVACTX_001_MOMENT_NOT_FOUND');
                } finally {
                    await CatalogItem.update({ isActive: true }, { where: { catalogItemId: unknownMomentItemId } });
                }
            });

            it('the two aliases resolve DIFFERENT objects and not two copies of the same', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    momentItemId: firstHoursItemId,
                    multidoseItemId: lastHoursItemId
                });

                expect(res.status).toBe(201);
                expect(res.body.data.moment.value).toBe('FIRST_HOURS');
                expect(res.body.data.multidoseMoment.value).toBe('LAST_HOURS');
            });

            it('a null foreign key resolves nothing and comes back as a null object', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, momentItemId: null, multidoseItemId: lastHoursItemId });

                expect(res.status).toBe(201);
                expect(res.body.data.moment).toBeNull();
                expect(res.body.data.multidoseMoment.value).toBe('LAST_HOURS');
            });
        });

        describe('the four counters', () => {

            it('a 0 is stored as 0 and never collapsed into null', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    vaccinatedPerVialCount: 0,
                    vaccinatedPerBatchCount: 0
                });

                expect(res.status).toBe(201);
                expect(res.body.data.vaccinatedPerVialCount).toBe(0);
                expect(res.body.data.vaccinatedPerBatchCount).toBe(0);
            });

            it('a negative counter is rejected by the validator with 400', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, vaccinatedPerVialCount: -1 });

                expect(res.status).toBe(400);
            });

            it('a counter above the smallint ceiling is a 400 and not a 500 from Postgres', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, vaccinatedPerVialCount: 40000 });

                expect(res.status).toBe(400);
            });
        });

        it('trims locations and notes on write', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, locations: '  Quito, Ibarra  ', notes: '  a note  ' });

            expect(res.status).toBe(201);
            expect(res.body.data.locations).toBe('Quito, Ibarra');
            expect(res.body.data.notes).toBe('a note');
        });

        it('returns the resolved investigation with its status and its case', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.data.investigation.investigationId).toBe(investigationId);
            expect(res.body.data.investigation.status).not.toBeNull();
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('a create without investigationId returns 400', async () => {
            const res = await create({});

            expect(res.status).toBe(400);
        });
    });

    describe('002A and 002B — the dual listing', () => {

        it('002A leaves out the contexts of inactive investigations and 002B includes them', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            const publicList = await list(`?investigationId=${ investigationId }`);
            expect(publicList.status).toBe(200);
            expect(publicList.body.data.count).toBe(0);
            expect(publicList.body.data.rows).toEqual([]);

            const adminList = await listAdmin(`?investigationId=${ investigationId }`);
            expect(adminList.status).toBe(200);
            expect(adminList.body.data.count).toBe(1);
            expect(adminList.body.data.rows[0].investigationId).toBe(investigationId);
        });

        it('a USER receives 403 on /admin', async () => {
            const res = await listAdmin('', 'USER');

            expect(res.status).toBe(403);
        });

        it('a context with momentItemId null appears in both listings: the catalog includes are not required', async () => {
            const investigationId = await seed();

            const publicList = await list(`?investigationId=${ investigationId }`);
            const adminList = await listAdmin(`?investigationId=${ investigationId }`);

            expect(publicList.body.data.count).toBe(1);
            expect(publicList.body.data.rows[0].moment).toBeNull();
            expect(publicList.body.data.rows[0].multidoseMoment).toBeNull();
            expect(adminList.body.data.count).toBe(1);
        });

        it('resolves the two catalog aliases as different objects in the listing too', async () => {
            const investigationId = await seed({
                momentItemId: firstHoursItemId,
                multidoseItemId: lastHoursItemId
            });

            const res = await list(`?investigationId=${ investigationId }`);

            expect(res.body.data.rows[0].moment.value).toBe('FIRST_HOURS');
            expect(res.body.data.rows[0].multidoseMoment.value).toBe('LAST_HOURS');
        });

        it('filters by caseId through the investigation include', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);

            const res = await list(`?caseId=${ caseId }`);

            expect(res.status).toBe(200);
            expect(res.body.data.count).toBe(1);
            expect(res.body.data.rows[0].investigationId).toBe(investigationId);
        });

        it('accumulates the two filters with AND', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);
            const otherInvestigationId = await seed();

            const matching = await list(`?caseId=${ caseId }&investigationId=${ investigationId }`);
            expect(matching.body.data.count).toBe(1);

            // The same case with an investigationId that does not belong to it: AND, not OR
            const crossed = await list(`?caseId=${ caseId }&investigationId=${ otherInvestigationId }`);
            expect(crossed.body.data.count).toBe(0);
        });

        it('a filter with a UUID that does not exist returns 200 with count 0, not 404', async () => {
            const res = await list(`?investigationId=${ unknownUuid }`);

            expect(res.status).toBe(200);
            expect(res.body.data.count).toBe(0);
            expect(res.body.data.rows).toEqual([]);
        });

        it('every row carries the full shape and neither isActive nor sysDetails', async () => {
            const investigationId = await seed({ vaccinatedPerVialCount: 0, locations: 'Quito' });
            const res = await list(`?investigationId=${ investigationId }`);
            const row = res.body.data.rows[0];

            for( const column of dataColumns ) {
                expect(row).toHaveProperty(column);
            }
            expect(row.vaccinatedPerVialCount).toBe(0);
            expect(row).toHaveProperty('appDetails');
            expect(row).toHaveProperty('deletedAt');
            expect(row.isActive).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
            expect(row.investigation.sysDetails).toBeUndefined();
            expect(row.investigation.status).not.toBeNull();
        });

        // UQ_investigation_case makes the chain case -> investigation -> context one to one on
        // BOTH hops, so several contexts cannot be isolated behind one caseId. These two cases
        // lean on the DESC order instead: the rows created last are the ones at the head of the
        // unfiltered listing
        it('paginates with limit and keeps the total in count', async () => {
            await seed();
            await seed();
            await seed();

            const res = await list('?limit=2');

            expect(res.body.data.rows).toHaveLength(2);
            expect(res.body.data.count).toBeGreaterThanOrEqual(3);
        });

        it('orders by createdAt DESC', async () => {
            const first = await seed();
            const second = await seed();

            const res = await list('?limit=2');
            const returned = res.body.data.rows.map((row: { investigationId: string }) => row.investigationId);

            expect(returned[0]).toBe(second);
            expect(returned[1]).toBe(first);
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape with the two catalogs resolved', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({
                investigationId,
                momentItemId: firstHoursItemId,
                multidoseItemId: lastHoursItemId,
                vaccinatedPerVialCount: 0,
                locations: 'Quito'
            })).status).toBe(201);

            const res = await getById(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.moment.value).toBe('FIRST_HOURS');
            expect(res.body.data.multidoseMoment.value).toBe('LAST_HOURS');
            expect(res.body.data.vaccinatedPerVialCount).toBe(0);
            expect(res.body.data.investigation.status).not.toBeNull();
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('an ID that does not exist returns 404', async () => {
            const res = await getById(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_003_NOT_FOUND');
        });

        it('an :id that is not a UUID returns 400', async () => {
            const res = await getById('not-a-uuid');

            expect(res.status).toBe(400);
        });

        it('a row whose investigation is inactive returns 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await getById(investigationId, 'USER')).status).toBe(404);
            expect((await getById(investigationId, 'ADMIN')).status).toBe(404);

            const superAdmin = await getById(investigationId, 'SUPERADMIN');
            expect(superAdmin.status).toBe(200);
            expect(superAdmin.body.data.investigation.isActive).toBe(false);
        });

        it('a row with deletedAt sealed but an active investigation IS returned: the seal does not hide it, its parent does', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await getById(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });

        it('moment and multidoseMoment come back null when their FK is null', async () => {
            const investigationId = await seed();

            const res = await getById(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.data.moment).toBeNull();
            expect(res.body.data.multidoseMoment).toBeNull();
        });

        it('exposes sysDetails in none of the objects of the response', async () => {
            const investigationId = await seed({ momentItemId: firstHoursItemId });

            const res = await getById(investigationId);

            expect(res.body.data.sysDetails).toBeUndefined();
            expect(res.body.data.isActive).toBeUndefined();
            expect(res.body.data.investigation.sysDetails).toBeUndefined();
            expect(res.body.data.moment.sysDetails).toBeUndefined();
        });

        it('/admin is not captured as an :id', async () => {
            const res = await listAdmin();

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty('count');
        });
    });

    describe('006 — get by case', () => {

        it('returns THE OBJECT and not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId, momentItemId: firstHoursItemId })).status).toBe(201);

            const res = await getByCase(caseId);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(false);
            expect(res.body.data).not.toHaveProperty('count');
            expect(res.body.data).not.toHaveProperty('rows');
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.moment.value).toBe('FIRST_HOURS');
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('a caseId that does not exist returns 404 CASE_NOT_FOUND', async () => {
            const res = await getByCase(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_006_CASE_NOT_FOUND');
        });

        it('an inactive case returns 404 CASE_NOT_FOUND', async () => {
            const caseId = await createCaseFixture(false);
            const res = await getByCase(caseId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_006_CASE_NOT_FOUND');
        });

        it('a case with no investigation returns 404 INVESTIGATION_NOT_FOUND', async () => {
            const caseId = await createCaseFixture();
            const res = await getByCase(caseId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_006_INVESTIGATION_NOT_FOUND');
        });

        it('an investigation with no context returns 404 NOT_FOUND', async () => {
            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);

            const res = await getByCase(caseId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_006_NOT_FOUND');
        });

        it('the three codes are distinct from one another', async () => {
            const noCase = await getByCase(unknownUuid);

            const withoutInvestigation = await createCaseFixture();
            const noInvestigation = await getByCase(withoutInvestigation);

            const withoutContext = await createCaseFixture();
            await createInvestigationForCase(withoutContext);
            const noContext = await getByCase(withoutContext);

            const codes = [noCase.body.code, noInvestigation.body.code, noContext.body.code];
            expect(new Set(codes).size).toBe(3);
        });

        it('an inactive investigation hides the context from USER and shows it to SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);
            await retireInvestigation(investigationId);

            const user = await getByCase(caseId, 'USER');
            expect(user.status).toBe(404);
            expect(user.body.code).toBe('INVVACTX_006_INVESTIGATION_NOT_FOUND');

            const superAdmin = await getByCase(caseId, 'SUPERADMIN');
            expect(superAdmin.status).toBe(200);
            expect(superAdmin.body.data.investigationId).toBe(investigationId);
        });

        it('a caseId that is not a UUID returns 400', async () => {
            const res = await getByCase('no-es-uuid');

            expect(res.status).toBe(400);
        });
    });

    describe('004 — update, differential', () => {

        it('a PUT resending the whole response of its GET writes nothing', async () => {
            const investigationId = await seed({
                momentItemId: firstHoursItemId,
                vaccinatedPerVialCount: 4,
                locations: 'Quito',
                isCluster: 'YES',
                clusterIdentificationNumber: 'C-7'
            });

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id: investigationId,
                model: InvestigationVaccinationContext,
                role: 'USER',
                // The response carries the resolved relations, which the update validator does not
                // declare; a real form does not send them back either
                strip: ['investigation', 'moment', 'multidoseMoment', 'appDetails', 'createdAt', 'updatedAt', 'deletedAt']
            });
        });

        it('an empty body behaves the same: 200 and nothing written', async () => {
            const investigationId = await seed({ notes: 'unchanged' });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, {});

            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('changing a single field adds ONE entry and bumps the version by 1', async () => {
            const investigationId = await seed();
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { notes: 'a note' });

            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('a note');
            expect(await versionOf(investigationId)).toBe((versionBefore ?? 0) + 1);

            const appDetails = await appDetailsOf(investigationId);
            expect(appDetails).toHaveLength(2);
            expect(appDetails[1].method).toBe('ESAVI-INVVACTX-004');
            expect(appDetails[0].method).toBe('ESAVI-INVVACTX-001');
        });

        it('does not use a post-diff cleanup: the service has no delete objectToUpdate', () => {
            const source = fs.readFileSync(
                path.join(process.cwd(), 'src', 'services', 'investigationVaccinationContext.service.ts'),
                'utf8'
            );

            expect(source).not.toContain('delete objectToUpdate');
            expect(source).toContain('buildDifferentialUpdate');
        });

        it('an ID that does not exist returns 404', async () => {
            const res = await update(unknownUuid, { notes: 'x' });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_004_NOT_FOUND');
        });

        it('a row whose investigation is inactive returns 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await update(investigationId, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(investigationId, { notes: 'y' }, 'ADMIN')).status).toBe(404);
            expect((await update(investigationId, { notes: 'z' }, 'SUPERADMIN')).status).toBe(200);
        });

        it('ignores a different investigationId in silence, with no 400', async () => {
            const investigationId = await seed();
            const otherInvestigationId = await createInvestigationFixture();

            const res = await update(investigationId, { investigationId: otherInvestigationId, notes: 'x' });

            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(await readRow(otherInvestigationId)).toBeNull();
        });

        describe('the four counters and the zero', () => {

            it.each([
                'vaccinatedPerVialCount',
                'vaccinatedPerBatchCount'
            ])('%s: 0 over a stored 12 is saved as 0, and null empties it', async (field) => {
                const investigationId = await seed({ [field]: 12 });

                const zeroed = await update(investigationId, { [field]: 0 });
                expect(zeroed.status).toBe(200);
                expect(zeroed.body.data[field]).toBe(0);

                const emptied = await update(investigationId, { [field]: null });
                expect(emptied.status).toBe(200);
                expect(emptied.body.data[field]).toBeNull();
            });

            it.each([
                'clusterAdditionalCaseCount',
                'clusterSameVialCount'
            ])('%s inside the open block: 0 is saved as 0, and null empties it', async (field) => {
                const investigationId = await seed({ isCluster: 'YES', [field]: 12 });

                const zeroed = await update(investigationId, { [field]: 0 });
                expect(zeroed.status).toBe(200);
                expect(zeroed.body.data[field]).toBe(0);

                const emptied = await update(investigationId, { [field]: null });
                expect(emptied.status).toBe(200);
                expect(emptied.body.data[field]).toBeNull();
            });
        });

        describe('the two answerOption columns', () => {

            it('null over a stored NO_ANSWER empties the field', async () => {
                const investigationId = await seed({ isCluster: 'NO_ANSWER' });

                const res = await update(investigationId, { isCluster: null });

                expect(res.status).toBe(200);
                expect(res.body.data.isCluster).toBeNull();
            });

            it('NO_ANSWER over a row that already holds it does NOT count as a change', async () => {
                const investigationId = await seed({ isCluster: 'NO_ANSWER' });
                const versionBefore = await versionOf(investigationId);

                const res = await update(investigationId, { isCluster: 'NO_ANSWER' });

                expect(res.status).toBe(200);
                expect(await versionOf(investigationId)).toBe(versionBefore);
            });
        });

        describe('the free texts and the trim', () => {

            it.each([
                ['locations', 'Quito'],
                ['notes', 'a note']
            ])('%s: the same text with surrounding blanks is not a change', async (field, value) => {
                const investigationId = await seed({ [field]: value });
                const versionBefore = await versionOf(investigationId);

                const res = await update(investigationId, { [field]: `   ${ value }   ` });

                expect(res.status).toBe(200);
                expect(res.body.data[field]).toBe(value);
                expect(await versionOf(investigationId)).toBe(versionBefore);
            });

            it('clusterIdentificationNumber inside the open block trims before comparing', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterIdentificationNumber: 'C-9' });
                const versionBefore = await versionOf(investigationId);

                const res = await update(investigationId, { clusterIdentificationNumber: '  C-9  ' });

                expect(res.status).toBe(200);
                expect(res.body.data.clusterIdentificationNumber).toBe('C-9');
                expect(await versionOf(investigationId)).toBe(versionBefore);
            });

            it('an empty string empties the field', async () => {
                const investigationId = await seed({ locations: 'Quito' });

                const res = await update(investigationId, { locations: '' });

                expect(res.status).toBe(200);
                expect(res.body.data.locations).toBeNull();
            });
        });

        describe('the cluster block', () => {

            it('isCluster NO over a row with the four fields filled leaves the FOUR null in ONE request', async () => {
                const investigationId = await seed({
                    isCluster: 'YES',
                    clusterIdentificationNumber: 'C-1',
                    clusterAdditionalCaseCount: 3,
                    clusterUsedSameVial: 'YES',
                    clusterSameVialCount: 2
                });

                const res = await update(investigationId, { isCluster: 'NO' });

                expect(res.status).toBe(200);
                expect(res.body.data.isCluster).toBe('NO');
                expect(res.body.data.clusterIdentificationNumber).toBeNull();
                expect(res.body.data.clusterAdditionalCaseCount).toBeNull();
                expect(res.body.data.clusterUsedSameVial).toBeNull();
                expect(res.body.data.clusterSameVialCount).toBeNull();
                expect(await appDetailsOf(investigationId)).toHaveLength(2);
            });

            it.each(closingIsClusterValues)('isCluster %p closes the block and forces the four to null', async (value) => {
                const investigationId = await seed({
                    isCluster: 'YES',
                    clusterIdentificationNumber: 'C-1',
                    clusterAdditionalCaseCount: 3
                });

                const res = await update(investigationId, { isCluster: value });

                expect(res.status).toBe(200);
                expect(res.body.data.clusterIdentificationNumber).toBeNull();
                expect(res.body.data.clusterAdditionalCaseCount).toBeNull();
            });

            it('a body that closes the block and describes it at the same time returns 400', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterIdentificationNumber: 'C-1' });

                const res = await update(investigationId, { isCluster: 'NO', clusterAdditionalCaseCount: 3 });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_004_CLUSTER_FIELDS_NOT_ALLOWED');
            });

            it('sending a cluster field as null while closing the block is NOT an error', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterIdentificationNumber: 'C-1' });

                const res = await update(investigationId, { isCluster: 'NO', clusterIdentificationNumber: null });

                expect(res.status).toBe(200);
                expect(res.body.data.clusterIdentificationNumber).toBeNull();
            });

            it('closing a block that was already closed and empty writes NOTHING', async () => {
                const investigationId = await seed({ isCluster: 'NO' });
                const versionBefore = await versionOf(investigationId);

                const res = await update(investigationId, { isCluster: 'NO' });

                expect(res.status).toBe(200);
                expect(await versionOf(investigationId)).toBe(versionBefore);
                expect(await appDetailsOf(investigationId)).toHaveLength(1);
            });

            it('isCluster YES over a row with an identifier already stored keeps the identifier', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterIdentificationNumber: 'C-5' });
                const versionBefore = await versionOf(investigationId);

                const res = await update(investigationId, { isCluster: 'YES' });

                expect(res.status).toBe(200);
                expect(res.body.data.clusterIdentificationNumber).toBe('C-5');
                expect(await versionOf(investigationId)).toBe(versionBefore);
            });
        });

        describe('the shared vial rule over the resulting state', () => {

            it('clusterUsedSameVial NO over a row with isCluster YES and no stored counter returns 400', async () => {
                const investigationId = await seed({ isCluster: 'YES' });

                const res = await update(investigationId, { clusterUsedSameVial: 'NO' });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_004_CLUSTER_SAME_VIAL_COUNT_REQUIRED');
            });

            it('the same body succeeds when the counter is already stored: the rule reads the resulting state', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterSameVialCount: 0 });

                const res = await update(investigationId, { clusterUsedSameVial: 'NO' });

                expect(res.status).toBe(200);
                expect(res.body.data.clusterUsedSameVial).toBe('NO');
                expect(res.body.data.clusterSameVialCount).toBe(0);
            });

            it('emptying the counter while clusterUsedSameVial stays NO returns 400', async () => {
                const investigationId = await seed({ isCluster: 'YES', clusterUsedSameVial: 'NO', clusterSameVialCount: 2 });

                const res = await update(investigationId, { clusterSameVialCount: null });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVVACTX_004_CLUSTER_SAME_VIAL_COUNT_REQUIRED');
            });
        });

        describe('the two catalog foreign keys before the diff', () => {

            it.each([
                ['momentItemId', 'INVVACTX_004_MOMENT_NOT_FOUND'],
                ['multidoseItemId', 'INVVACTX_004_MULTIDOSE_NOT_FOUND']
            ])('%s pointing at an INACTIVE item returns 404 even when it matches what is stored', async (field, code) => {
                const investigationId = await seed({ [field]: unknownMomentItemId });
                await CatalogItem.update({ isActive: false }, { where: { catalogItemId: unknownMomentItemId } });

                try {
                    const res = await update(investigationId, { [field]: unknownMomentItemId });

                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe(code);
                } finally {
                    await CatalogItem.update({ isActive: true }, { where: { catalogItemId: unknownMomentItemId } });
                }
            });

            it('an item of another catalog returns 404 with the code of its own column', async () => {
                const investigationId = await seed();

                const moment = await update(investigationId, { momentItemId: foreignCatalogItemId });
                expect(moment.status).toBe(404);
                expect(moment.body.code).toBe('INVVACTX_004_MOMENT_NOT_FOUND');

                const multidose = await update(investigationId, { multidoseItemId: foreignCatalogItemId });
                expect(multidose.status).toBe(404);
                expect(multidose.body.code).toBe('INVVACTX_004_MULTIDOSE_NOT_FOUND');
            });

            it('an explicit null resolves nothing and empties the column', async () => {
                const investigationId = await seed({ momentItemId: firstHoursItemId });

                const res = await update(investigationId, { momentItemId: null });

                expect(res.status).toBe(200);
                expect(res.body.data.momentItemId).toBeNull();
                expect(res.body.data.moment).toBeNull();
            });
        });
    });

    describe('005C — purge', () => {

        it('purging a row with no deletedAt sealed returns 409 and the row survives', async () => {
            const investigationId = await seed();

            const res = await purge(investigationId);

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVVACTX_005C_NOT_DELETED');
            expect(res.body.message).toContain(investigationId);
            // The proof that the isActive check of purgeEntityService is INERT here: without
            // assertRowIsSealed this row would already be gone
            expect(await readRow(investigationId)).not.toBeNull();
        });

        it('a sealed row is purged: 200 without data, and the row is really gone', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await purge(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(investigationId)).toBeNull();
        });

        it('repeating the purge returns 404', async () => {
            const investigationId = await seed();
            await seal(investigationId);
            expect((await purge(investigationId)).status).toBe(200);

            const res = await purge(investigationId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVVACTX_005C_NOT_FOUND');
        });

        it('an ADMIN receives 403', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await purge(investigationId, 'ADMIN');

            expect(res.status).toBe(403);
            expect(await readRow(investigationId)).not.toBeNull();
        });

        it('purges a row hanging from a RETIRED investigation: no inherited visibility here', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);
            await seal(investigationId);

            const res = await purge(investigationId);

            expect(res.status).toBe(200);
            expect(await readRow(investigationId)).toBeNull();
        });

        it('after purging, a POST over that same investigation returns 201: only the purge frees the slot', async () => {
            const investigationId = await seed();
            await seal(investigationId);
            expect((await purge(investigationId)).status).toBe(200);

            const res = await create({ investigationId });

            expect(res.status).toBe(201);
        });

        it('leaves the investigation and the vaccinationMoment items intact', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({
                investigationId,
                momentItemId: firstHoursItemId,
                multidoseItemId: lastHoursItemId
            })).status).toBe(201);
            await seal(investigationId);

            expect((await purge(investigationId)).status).toBe(200);

            expect(await Investigation.findByPk(investigationId)).not.toBeNull();
            expect(await EsaviCase.findByPk(caseId)).not.toBeNull();
            expect(await CatalogItem.findByPk(firstHoursItemId)).not.toBeNull();
            expect(await CatalogItem.findByPk(lastHoursItemId)).not.toBeNull();
        });

        it('an :id that does not exist returns 404 and one that is not a UUID returns 400', async () => {
            expect((await purge(unknownUuid)).status).toBe(404);
            expect((await purge('no-es-uuid')).status).toBe(400);
        });

        it('writes the snapshot of the whole row to the log at warn level', async () => {
            const investigationId = await seed({ locations: 'Ibarra', vaccinatedPerVialCount: 7 });
            await seal(investigationId);
            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;

            expect((await purge(investigationId)).status).toBe(200);

            const written = fs.readFileSync(logPath, 'utf8').slice(logBefore);
            expect(written).toContain('ESAVI-INVVACTX-005C');
            expect(written).toContain(investigationId);
            expect(written).toContain('Ibarra');
        });
    });

    // The end to end walkthrough the plan asks for as a single thread: the same row is opened
    // empty, read by both accesses, found through both listings with each filter, completed by
    // the update and finally destroyed. The blocks above check each operation in isolation and
    // its error paths; this one checks that the seven of them compose over ONE row, which is
    // how the entity is actually used - the context is opened when the investigation starts and
    // filled in over the days that follow
    describe('the full walkthrough over one row', () => {

        it('creates empty, reads, lists, updates and purges the same context', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);

            // 001 - opened empty: the eleven data columns come back null
            const created = await create({ investigationId });
            expect(created.status).toBe(201);
            for( const column of dataColumns ) {
                expect(created.body.data[column]).toBeNull();
            }

            // 003 - by its own id, which is the investigationId
            const byId = await getById(investigationId);
            expect(byId.status).toBe(200);
            expect(byId.body.data.investigationId).toBe(investigationId);

            // 006 - by the caseId, walking the two one to one hops
            const byCase = await getByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.investigationId).toBe(investigationId);

            // 002A with each filter, and 002B with them too
            for( const query of [`?investigationId=${ investigationId }`, `?caseId=${ caseId }`] ) {
                const publicList = await list(query);
                expect(publicList.status).toBe(200);
                expect(publicList.body.data.count).toBe(1);
                expect(publicList.body.data.rows[0].investigationId).toBe(investigationId);

                const adminList = await listAdmin(query);
                expect(adminList.status).toBe(200);
                expect(adminList.body.data.count).toBe(1);
            }

            // 004 - the form is filled in over time: the time slots, the shared exposure and the
            // cluster, all in one save
            const updated = await update(investigationId, {
                momentItemId: firstHoursItemId,
                multidoseItemId: lastHoursItemId,
                vaccinatedPerVialCount: 0,
                vaccinatedPerBatchCount: 120,
                locations: '  Quito, Ibarra  ',
                isCluster: 'YES',
                clusterIdentificationNumber: '  C-42  ',
                clusterAdditionalCaseCount: 3,
                clusterUsedSameVial: 'NO',
                clusterSameVialCount: 2,
                notes: 'completed on the second visit'
            });
            expect(updated.status).toBe(200);
            expect(updated.body.data.moment.value).toBe('FIRST_HOURS');
            expect(updated.body.data.multidoseMoment.value).toBe('LAST_HOURS');
            expect(updated.body.data.vaccinatedPerVialCount).toBe(0);
            expect(updated.body.data.vaccinatedPerBatchCount).toBe(120);
            expect(updated.body.data.locations).toBe('Quito, Ibarra');
            expect(updated.body.data.clusterIdentificationNumber).toBe('C-42');
            expect(updated.body.data.clusterSameVialCount).toBe(2);
            expect(await appDetailsOf(investigationId)).toHaveLength(2);

            // Saving again without changing anything writes nothing
            const versionAfterUpdate = await versionOf(investigationId);
            expect((await update(investigationId, {})).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionAfterUpdate);

            // 005C - the seal first, because the purge only reaches what was retired before
            expect((await purge(investigationId)).status).toBe(409);
            await seal(investigationId);
            expect((await purge(investigationId)).status).toBe(200);

            // Gone, and the slot released: the same investigation admits a new context
            expect(await readRow(investigationId)).toBeNull();
            expect((await getById(investigationId)).status).toBe(404);
            expect((await create({ investigationId })).status).toBe(201);
        });
    });
});
