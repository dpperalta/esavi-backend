import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationCommunity, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationCommunity operations of SPEC F40. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access by
 * case, and the two domain rules evaluated over the resulting state.
 *
 * Three things separate this entity from its sisters and get deliberate coverage:
 *
 *  - THE PRECEDENCE BETWEEN THE TWO RULES OF THE BLOCK. With hadSimilarEvent closed AND a
 *    description in the body, the answer must be SIMILAR_EVENT_FIELDS_NOT_ALLOWED and never
 *    SIMILAR_EVENT_DESCRIPTION_REQUIRED. An implementation that evaluates the obligation first
 *    passes every other case of the block and fails only here, which is why the case exists.
 *  - THE FOUR COUNTERS STAY OPTIONAL WITH THE BLOCK OPEN. A create with 'YES', a description and
 *    NO counter at all must return 201. It is the only net that stops a future maintainer from
 *    reading the `required` of the DDL comment as "the five of them" and breaking the contract
 *    in silence.
 *  - ZERO IS A VALUE AND NOT AN ABSENCE, on the four counters and on the two coordinates. A
 *    truthiness check in the service would make { hadSimilarEvent: 'NO', similarEventCount: 0 }
 *    a 201 that lies about what it saved, and would turn a home on the equator into a null.
 *
 * The two coordinates get coverage of their own as INDEPENDENT columns: one without the other is
 * a valid row, and the case that stores half of the pair is what breaks if somebody later
 * "fixes" them into a pair rule.
 */
describe('investigationCommunity contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-communities';
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

    let statusZeroItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // Every fixture is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Community ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CM${ counter }${ suffix }`),
            healthSystemCode: `CM${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `CM${ counter }${ suffix }`,
            name: `Community ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CM-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    // statusItemId is passed explicitly: an investigation created straight through the model
    // skips the service of F28 that resolves the default status
    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> =>
        await createInvestigationForCase(await createCaseFixture(), isActive);

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    // The empty create of this entity: { investigationId } is the whole minimum. Mints an
    // investigation and its community record in one go
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

    const readRow = async (id: string) => await InvestigationCommunity.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationCommunity.update({ deletedAt: at }, { where: { investigationId } });

    // The ten data columns of the DDL, all nullable and none of them required
    const dataColumns = [
        'patientLatitude', 'patientLongitude', 'hadSimilarEvent', 'similarEventDescription',
        'similarEventCount', 'affectedVaccinated', 'affectedUnvaccinated', 'affectedUnknown',
        'otherComments', 'notes'
    ];

    // The five fields the flag governs. The order means nothing: there is no precedence among them
    const blockFields = [
        'similarEventDescription', 'similarEventCount', 'affectedVaccinated',
        'affectedUnvaccinated', 'affectedUnknown'
    ];

    // The four states that close the block besides null. Every one of them closes it alike
    const closingAnswers = ['NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'];

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const type = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        const item = await CatalogItem.findOne({
            where: { catalogTypeId: type!.getDataValue('catalogTypeId'), code: '0' }
        });
        statusZeroItemId = item!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('the empty create returns 201 with the ten data columns in null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            for( const column of dataColumns ) {
                expect(res.body.data[column]).toBeNull();
            }
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.deletedAt).toBeNull();
            expect((await appDetailsOf(investigationId))[0].method).toBe('ESAVI-INVCOMM-001');
        });

        it('neither sysDetails nor isActive travel in the response', async () => {
            const investigationId = await seed();
            const res = await getById(investigationId);

            expect(res.body.data.sysDetails).toBeUndefined();
            // The column does not exist: this entity has no state of its own
            expect(res.body.data.isActive).toBeUndefined();
        });

        it('the investigation travels narrowed to three fields', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            const res = await create({ investigationId });

            expect(res.body.data.investigation).toEqual({ investigationId, caseId, isActive: true });
        });

        it('repeating the create returns 409, and keeps returning it once the row is sealed', async () => {
            const investigationId = await seed();

            const duplicate = await create({ investigationId });
            expect(duplicate.status).toBe(409);
            expect(duplicate.body.code).toBe('INVCOMM_001_ALREADY_EXISTS');
            expect(duplicate.body.message).toContain(investigationId);

            // The logical seal does NOT release the slot of the primary key
            await seal(investigationId);
            expect((await create({ investigationId })).status).toBe(409);
        });

        it('an inactive or unknown investigation returns 404', async () => {
            const inactive = await createInvestigationFixture(false);
            const res = await create({ investigationId: inactive });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOMM_001_INVESTIGATION_NOT_FOUND');

            expect((await create({ investigationId: unknownUuid })).status).toBe(404);
        });

        it('trims the three free texts and stores a blank one as null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'YES',
                similarEventDescription: '  tres casos en el barrio  ',
                otherComments: '  el informante insiste  ',
                notes: '   '
            });

            expect(res.status).toBe(201);
            expect(res.body.data.similarEventDescription).toBe('tres casos en el barrio');
            expect(res.body.data.otherComments).toBe('el informante insiste');
            expect(res.body.data.notes).toBeNull();
        });
    });

    describe('001 — the similar event block', () => {

        it('only YES opens the block: the four other answers and null forbid the five fields', async () => {
            for( const answer of closingAnswers ) {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    hadSimilarEvent: answer,
                    similarEventDescription: 'tres casos en el barrio'
                });
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
            }

            // Without the flag at all: null closes the block like the other four
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, similarEventDescription: 'tres casos' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
        });

        it('each of the five fields offends on its own with the block closed', async () => {
            const values: Record<string, unknown> = {
                similarEventDescription: 'tres casos',
                similarEventCount: 3,
                affectedVaccinated: 2,
                affectedUnvaccinated: 1,
                affectedUnknown: 4
            };
            for( const field of blockFields ) {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, hadSimilarEvent: 'NO', [field]: values[field] });
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
            }
        });

        it('a zero counter offends too: zero is a value, not an absence', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, hadSimilarEvent: 'NO', similarEventCount: 0 });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
        });

        it('sending the five fields explicitly as null with the block closed is not an offence', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'NO',
                similarEventDescription: null,
                similarEventCount: null,
                affectedVaccinated: null,
                affectedUnvaccinated: null,
                affectedUnknown: null
            });

            expect(res.status).toBe(201);
            expect(res.body.data.hadSimilarEvent).toBe('NO');
            for( const field of blockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
        });

        // THE CASE OF THE PRECEDENCE. An implementation that evaluates the obligation first
        // answers the other code and passes every other case of this describe
        it('the prohibition runs before the obligation, and never the other way round', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'NO',
                similarEventDescription: 'tres casos en el barrio'
            });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
            expect(res.body.code).not.toBe('INVCOMM_001_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        it('opening the block without a description is 400', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, hadSimilarEvent: 'YES' });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        it('a blank description does not satisfy the obligation either', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, hadSimilarEvent: 'YES', similarEventDescription: '   ' });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        it('the counters do not stand in for the description', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, hadSimilarEvent: 'YES', similarEventCount: 3 });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_001_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        // THE CASE OF THE OPTIONAL COUNTERS. Without it, reading the `required` of the DDL
        // comment as "the five of them" would break the contract in silence
        it('an open block with a description and NO counter at all is 201', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });

            expect(res.status).toBe(201);
            expect(res.body.data.similarEventDescription).toBe('tres casos en el barrio');
            expect(res.body.data.similarEventCount).toBeNull();
            expect(res.body.data.affectedVaccinated).toBeNull();
            expect(res.body.data.affectedUnvaccinated).toBeNull();
            expect(res.body.data.affectedUnknown).toBeNull();
        });

        it('the counters are not validated against each other', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'YES',
                similarEventDescription: 'brote en el sector',
                similarEventCount: 2,
                affectedVaccinated: 4,
                affectedUnvaccinated: 3,
                affectedUnknown: 2
            });

            // 4 + 3 + 2 = 9 against a declared total of 2, and it is stored as it arrives
            expect(res.status).toBe(201);
            expect(res.body.data.similarEventCount).toBe(2);
            expect(res.body.data.affectedVaccinated).toBe(4);
        });
    });

    describe('001 — the fields with no rules', () => {

        it('the two coordinates are independent: one without the other is a valid row', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, patientLatitude: -0.1806532 });

            expect(res.status).toBe(201);
            expect(Number(res.body.data.patientLatitude)).toBe(-0.1806532);
            expect(res.body.data.patientLongitude).toBeNull();
        });

        it('a zero coordinate is stored as zero and not as null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, patientLatitude: 0, patientLongitude: 0 });

            expect(res.status).toBe(201);
            expect(Number(res.body.data.patientLatitude)).toBe(0);
            expect(Number(res.body.data.patientLongitude)).toBe(0);
            expect(res.body.data.patientLatitude).not.toBeNull();
            expect(res.body.data.patientLongitude).not.toBeNull();
        });

        it('otherComments and notes are stored with the block closed: they are outside it', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hadSimilarEvent: 'NO',
                otherComments: 'la comunidad no reportó nada',
                notes: 'visita domiciliaria realizada'
            });

            expect(res.status).toBe(201);
            expect(res.body.data.otherComments).toBe('la comunidad no reportó nada');
            expect(res.body.data.notes).toBe('visita domiciliaria realizada');
        });
    });

    describe('the shape validations', () => {

        it('rejects a hadSimilarEvent outside the ENUM', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, hadSimilarEvent: 'MAYBE' });

            expect(res.status).toBe(400);
            // validateFields answers with common.validationError and carries no operation code:
            // the shape validations are not a rule of the domain
            expect(res.body.ok).toBe(false);
            expect(res.body.errors).toContain('Had Similar Event must be one of');
        });

        it('replicates the geographic range even though the DDL does not declare it', async () => {
            const investigationId = await createInvestigationFixture();

            expect((await create({ investigationId, patientLatitude: 500 })).status).toBe(400);
            expect((await create({ investigationId, patientLatitude: -91 })).status).toBe(400);
            expect((await create({ investigationId, patientLongitude: 200 })).status).toBe(400);
            expect((await create({ investigationId, patientLongitude: -181 })).status).toBe(400);
        });

        it('rejects a coordinate with eight decimals, so it is a 400 and not an error of Postgres', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, patientLatitude: -0.18065321 });

            expect(res.status).toBe(400);
        });

        it('replicates the CHECK >= 0 and the smallint ceiling on the four counters', async () => {
            const investigationId = await createInvestigationFixture();

            for( const field of ['similarEventCount', 'affectedVaccinated', 'affectedUnvaccinated', 'affectedUnknown'] ) {
                expect((await create({ investigationId, hadSimilarEvent: 'YES', similarEventDescription: 'x', [field]: -1 })).status).toBe(400);
                expect((await create({ investigationId, hadSimilarEvent: 'YES', similarEventDescription: 'x', [field]: 40000 })).status).toBe(400);
            }
        });

        it('declares the four counters as SMALLINT in the model, not as INTEGER', () => {
            const attributes = InvestigationCommunity.getAttributes() as Record<string, { type: unknown }>;

            for( const field of ['similarEventCount', 'affectedVaccinated', 'affectedUnvaccinated', 'affectedUnknown'] ) {
                expect(attributes[field].type.constructor.name).toBe('SMALLINT');
            }
        });

        it('the three text columns have no length cap', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, notes: 'x'.repeat(5000) });

            expect(res.status).toBe(201);
            expect(res.body.data.notes).toHaveLength(5000);
        });
    });

    describe('002A and 002B — the dual listing', () => {

        it('a community record of a retired investigation is out of 002A and in 002B', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            const publicRes = await list(`?investigationId=${ investigationId }`);
            expect(publicRes.status).toBe(200);
            expect(publicRes.body.data).toEqual({ count: 0, rows: [] });

            const adminRes = await listAdmin(`?investigationId=${ investigationId }`);
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.data.count).toBe(1);
            expect(adminRes.body.data.rows[0].investigation.isActive).toBe(false);
        });

        it('the two filters are accumulative with AND and by equality', async () => {
            const caseIdA = await createCaseFixture();
            const investigationA = await createInvestigationForCase(caseIdA);
            await create({ investigationId: investigationA });

            const caseIdB = await createCaseFixture();
            const investigationB = await createInvestigationForCase(caseIdB);
            await create({ investigationId: investigationB });

            const both = await list(`?investigationId=${ investigationA }&caseId=${ caseIdA }`);
            expect(both.body.data.count).toBe(1);
            expect(both.body.data.rows[0].investigationId).toBe(investigationA);

            const crossed = await list(`?investigationId=${ investigationA }&caseId=${ caseIdB }`);
            expect(crossed.body.data.count).toBe(0);

            const byCase = await list(`?caseId=${ caseIdB }`);
            expect(byCase.body.data.count).toBe(1);
            expect(byCase.body.data.rows[0].investigationId).toBe(investigationB);
        });

        it('a filter with a UUID that matches nothing is 200 and not 404', async () => {
            const res = await list(`?caseId=${ unknownUuid }`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ count: 0, rows: [] });
        });

        it('orders by createdAt DESC and carries the full shape in every row', async () => {
            await seed();
            await seed({ patientLatitude: -0.2299, patientLongitude: -78.5249 });

            const res = await list();
            expect(res.status).toBe(200);

            const dates = (res.body.data.rows as { createdAt: string }[]).map(row => new Date(row.createdAt).getTime());
            expect([...dates].sort((a, b) => b - a)).toEqual(dates);

            // No reduced shape: the ten columns travel in the listing too, coordinates included
            for( const column of dataColumns ) {
                expect(res.body.data.rows[0]).toHaveProperty(column);
            }
            expect(res.body.data.rows[0].sysDetails).toBeUndefined();
        });

        it('002B is closed to USER', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
            expect((await list()).status).toBe(200);
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape of the ten columns', async () => {
            const investigationId = await seed({ notes: 'observación' });
            const res = await getById(investigationId);

            expect(res.status).toBe(200);
            for( const column of dataColumns ) {
                expect(res.body.data).toHaveProperty(column);
            }
            expect(res.body.data).toHaveProperty('appDetails');
            expect(res.body.data.sysDetails).toBeUndefined();
        });

        it('an unknown investigationId is 404', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOMM_003_NOT_FOUND');
        });

        it('a row of a retired investigation is 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await getById(investigationId, 'USER')).status).toBe(404);
            expect((await getById(investigationId, 'ADMIN')).status).toBe(404);
            expect((await getById(investigationId, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('006 — get by case', () => {

        it('returns the object and not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
        });

        it('distinguishes the three 404 with three distinct codes', async () => {
            // The case does not exist
            const unknownCase = await getByCase(unknownUuid);
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('INVCOMM_006_CASE_NOT_FOUND');

            // The case exists but has no visible investigation
            const caseWithoutInvestigation = await createCaseFixture();
            const noInvestigation = await getByCase(caseWithoutInvestigation);
            expect(noInvestigation.status).toBe(404);
            expect(noInvestigation.body.code).toBe('INVCOMM_006_INVESTIGATION_NOT_FOUND');

            // The investigation exists but has no community record
            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);
            const noCommunity = await getByCase(caseId);
            expect(noCommunity.status).toBe(404);
            expect(noCommunity.body.code).toBe('INVCOMM_006_NOT_FOUND');
        });

        it('a row of a retired investigation is 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });
            await retireInvestigation(investigationId);

            expect((await getByCase(caseId, 'USER')).status).toBe(404);
            expect((await getByCase(caseId, 'ADMIN')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('004 — the differential update', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const investigationId = await seed({
                patientLatitude: -0.2299,
                patientLongitude: -78.5249,
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio',
                similarEventCount: 3,
                notes: 'observación inicial'
            });

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id: investigationId,
                model: InvestigationCommunity,
                role: 'USER',
                strip: ['investigationId', 'investigation', 'createdAt', 'updatedAt', 'deletedAt', 'appDetails']
            });
        });

        it('an empty body behaves the same way', async () => {
            const investigationId = await seed({ notes: 'algo' });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, {});
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('changing a single field adds one appDetails entry and bumps the version by 1', async () => {
            const investigationId = await seed();
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { notes: 'hallazgo nuevo' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('hallazgo nuevo');

            const details = await appDetailsOf(investigationId);
            expect(details).toHaveLength(2);
            expect(details[1].method).toBe('ESAVI-INVCOMM-004');
            expect(await versionOf(investigationId)).toBe((versionBefore ?? 0) + 1);
            expect((await readRow(investigationId))!.getDataValue('updatedAt')).not.toBeNull();
        });

        // pg hands the DECIMAL back as a string and the body sends a number: without the numeric
        // rule of the helper every PUT of a form with coordinates would write
        it('resending the same coordinate does not count as a change', async () => {
            const investigationId = await seed({ patientLatitude: -0.2299, patientLongitude: -78.5249 });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { patientLatitude: -0.2299, patientLongitude: -78.5249 });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('a zero already stored is compared as a value and not discarded as an absence', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos',
                affectedVaccinated: 0
            });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { affectedVaccinated: 0 });
            expect(res.status).toBe(200);
            expect(res.body.data.affectedVaccinated).toBe(0);
            expect(await versionOf(investigationId)).toBe(versionBefore);
        });

        it('a zero coordinate is stored as zero and not as null', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, { patientLatitude: 0 });
            expect(res.status).toBe(200);
            expect(Number(res.body.data.patientLatitude)).toBe(0);
            expect(res.body.data.patientLatitude).not.toBeNull();
        });

        it('investigationId is ignored in silence, with no 400 and with no write', async () => {
            const investigationId = await seed();
            const other = await createInvestigationFixture();

            const res = await update(investigationId, { investigationId: other });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('a PUT over a row of a retired investigation is 404 for USER and ADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await update(investigationId, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(investigationId, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await update(investigationId, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
        });

        it('an unknown investigationId is 404', async () => {
            const res = await update(unknownUuid, { notes: 'x' });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOMM_004_NOT_FOUND');
        });

        it('the three free texts are trimmed before being compared', async () => {
            const investigationId = await seed({ notes: 'observación' });
            const versionBefore = await versionOf(investigationId);

            // Only surrounding blanks: nothing changed
            const res = await update(investigationId, { notes: '  observación  ' });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
        });
    });

    describe('004 — the similar event block', () => {

        // The obligation looks at the RESULTING state, not at the body
        it('a PUT of an unrelated field over an open and described row is 200', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });

            const res = await update(investigationId, { notes: 'visita realizada' });
            expect(res.status).toBe(200);
            expect(res.body.data.similarEventDescription).toBe('tres casos en el barrio');
        });

        it('emptying the description while the block stays open is 400', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });

            const res = await update(investigationId, { similarEventDescription: null });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_004_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        it('emptying it together with the flag, in the same request, is 200 and clears the five', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio',
                similarEventCount: 3
            });

            const res = await update(investigationId, { similarEventDescription: null, hadSimilarEvent: 'NO' });
            expect(res.status).toBe(200);
            expect(res.body.data.hadSimilarEvent).toBe('NO');
            for( const field of blockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
        });

        // THE ASYMMETRY 001 / 004: what does not travel is forced to null with no error
        it('closing the block clears the five fields without asking and without an error', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio',
                similarEventCount: 3,
                affectedVaccinated: 2,
                affectedUnvaccinated: 1,
                affectedUnknown: 0
            });

            const res = await update(investigationId, { hadSimilarEvent: 'NO' });
            expect(res.status).toBe(200);
            for( const field of blockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
        });

        it('but a field travelling WITH A VALUE next to the closing flag is 400', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });

            const res = await update(investigationId, { hadSimilarEvent: 'NO', similarEventCount: 2 });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_004_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
        });

        it('and sending it explicitly as null is not an error', async () => {
            const investigationId = await seed({
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });

            const res = await update(investigationId, { hadSimilarEvent: 'NO', similarEventCount: null });
            expect(res.status).toBe(200);
            expect(res.body.data.similarEventCount).toBeNull();
        });

        // The forcing to null is a conditional derivative and goes through the diff like any other
        // candidate: it does not write when there is nothing to change
        it('closing an already closed block writes nothing', async () => {
            const investigationId = await seed({ hadSimilarEvent: 'NO' });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { hadSimilarEvent: 'NO' });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('the prohibition runs before the obligation on the update too', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, {
                hadSimilarEvent: 'NO',
                similarEventDescription: 'tres casos en el barrio'
            });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_004_SIMILAR_EVENT_FIELDS_NOT_ALLOWED');
        });

        it('opening the block over an empty row without a description is 400', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, { hadSimilarEvent: 'YES' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOMM_004_SIMILAR_EVENT_DESCRIPTION_REQUIRED');
        });

        it('opening it with a description and no counter is 200', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, {
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio'
            });
            expect(res.status).toBe(200);
            expect(res.body.data.similarEventCount).toBeNull();
        });
    });

    describe('005C — physical delete', () => {

        it('a row with no deletedAt is 409', async () => {
            const investigationId = await seed();

            const res = await purge(investigationId);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVCOMM_005C_NOT_DELETED');
            expect(res.body.message).toContain(investigationId);
            expect(await readRow(investigationId)).not.toBeNull();
        });

        it('a sealed row is 200 without data, and the row is gone', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await purge(investigationId);
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(investigationId)).toBeNull();
        });

        it('writes the snapshot of the whole row to the log at warn level', async () => {
            const investigationId = await seed({ notes: 'Ibarra', patientLatitude: -0.3306532 });
            await seal(investigationId);
            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;

            expect((await purge(investigationId)).status).toBe(200);

            const written = fs.readFileSync(logPath, 'utf8').slice(logBefore);
            expect(written).toContain('ESAVI-INVCOMM-005C');
            expect(written).toMatch(/WARN/i);
            expect(written).toContain(investigationId);
            expect(written).toContain('Ibarra');
        });

        it('only the purge releases the investigationId', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            // Still occupied while only sealed
            expect((await create({ investigationId })).status).toBe(409);

            expect((await purge(investigationId)).status).toBe(200);
            expect((await create({ investigationId })).status).toBe(201);
        });

        it('an unknown id is 404 and the operation is SUPERADMIN only', async () => {
            expect((await purge(unknownUuid)).status).toBe(404);

            const investigationId = await seed();
            await seal(investigationId);
            expect((await purge(investigationId, 'ADMIN')).status).toBe(403);
            expect((await purge(investigationId, 'USER')).status).toBe(403);
            expect((await purge(investigationId, 'SUPERADMIN')).status).toBe(200);
        });

        it('a row of a retired investigation is still purgeable', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);
            await seal(investigationId);

            expect((await purge(investigationId)).status).toBe(200);
        });
    });

    // The end to end walkthrough as a single thread: the same row is opened empty, read by both
    // listings and by the two accesses, completed by the update and finally destroyed
    describe('the seven operations over one row', () => {

        it('walks the entity end to end', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);

            // 001 — opened empty
            const created = await create({ investigationId });
            expect(created.status).toBe(201);
            expect(created.body.data.hadSimilarEvent).toBeNull();

            // 002A and 002B — visible in both while the investigation is alive
            expect((await list(`?investigationId=${ investigationId }`)).body.data.count).toBe(1);
            expect((await listAdmin(`?investigationId=${ investigationId }`)).body.data.count).toBe(1);

            // 003 and 006 — the two accesses to the same row
            expect((await getById(investigationId)).status).toBe(200);
            expect((await getByCase(caseId)).body.data.investigationId).toBe(investigationId);

            // 004 — the form is filled in over time
            const updated = await update(investigationId, {
                patientLatitude: -0.2299,
                patientLongitude: -78.5249,
                hadSimilarEvent: 'YES',
                similarEventDescription: 'tres casos en el barrio',
                similarEventCount: 3,
                affectedVaccinated: 1,
                affectedUnvaccinated: 2,
                affectedUnknown: 0,
                otherComments: 'el informante insiste',
                notes: 'visita domiciliaria realizada'
            });
            expect(updated.status).toBe(200);
            expect(updated.body.data.affectedUnknown).toBe(0);
            expect(await appDetailsOf(investigationId)).toHaveLength(2);

            // The drag: retiring the investigation seals the community record
            await request(app).delete(`/api/investigations/${ investigationId }`).set(authHeader('ADMIN'));
            expect((await readRow(investigationId))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await getById(investigationId, 'USER')).status).toBe(404);

            // 005C — and only then can it be destroyed
            expect((await purge(investigationId)).status).toBe(200);
            expect(await readRow(investigationId)).toBeNull();
        });
    });
});
