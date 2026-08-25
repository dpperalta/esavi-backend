import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationVaccinationContext, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
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

    const readRow = async (id: string) => await InvestigationVaccinationContext.findByPk(id, { paranoid: false });

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

        statusZeroItemId = await itemOf('investigationStatus', '0');

        // The three items SPEC F36 step 1 seeds in the DDL. If these throw, the seeding did not
        // reach the schema and every POST carrying a moment would answer 404
        firstHoursItemId = await itemOf('vaccinationMoment', 'FIRST_HOURS');
        lastHoursItemId = await itemOf('vaccinationMoment', 'LAST_HOURS');
        unknownMomentItemId = await itemOf('vaccinationMoment', 'UNKNOWN');

        // An ACTIVE item of a different catalog. It is what proves the double hop is implemented
        // and not merely the existence of the UUID
        foreignCatalogItemId = await itemOf('sex', 'FEMALE');
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
                expect(res.body.data.moment.code).toBe('FIRST_HOURS');
                expect(res.body.data.multidoseMoment.code).toBe('LAST_HOURS');
            });

            it('a null foreign key resolves nothing and comes back as a null object', async () => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, momentItemId: null, multidoseItemId: lastHoursItemId });

                expect(res.status).toBe(201);
                expect(res.body.data.moment).toBeNull();
                expect(res.body.data.multidoseMoment.code).toBe('LAST_HOURS');
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
});
