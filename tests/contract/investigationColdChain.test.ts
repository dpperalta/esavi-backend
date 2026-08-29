import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationColdChain, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationColdChain operations of SPEC F38. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access by
 * case, and the two domain rules evaluated over the resulting state.
 *
 * Three things separate this entity from its sisters and get deliberate coverage:
 *
 *  - It is the FIRST mutual exclusion of the repository resolved by precedence and not only by
 *    error. transportUsedThermos and transportUsedColdPack describe the same fact and cannot
 *    both be 'YES', but the outcome depends on WHERE each 'YES' comes from: conflict when both
 *    travel in the body (400), relay when one travels and the other is stored (the body wins,
 *    no error), and inherited tie when neither travels and both are stored (the thermos wins by
 *    precedence, no error). The three are exercised one by one.
 *  - THE INHERITED TIE IS PRODUCED BY NO OPERATION OF THE API, so its precedence branch would
 *    rot unnoticed. The only way to cover it is seeding the row by direct SQL, which is what the
 *    case below does.
 *  - transportSetInThermos, transportReturnedInThermos and transportTypeThermo carry Thermos in
 *    the name but describe THE CONTAINER — thermos or cold pack — so they belong to no
 *    conditional block. The case that stores them with both flags in 'NO' and in null is what
 *    breaks if somebody later "fixes" them by hanging them from transportUsedThermos.
 *
 * The false gets deliberate coverage of its own on the two boolean columns: a truthiness check
 * in the service would throw it away, and "it was monitored and there was no deviation" — the
 * most frequent finding of the form — would become inexpressible while still answering 201.
 */
describe('investigationColdChain contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-cold-chains';
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
            names: esaviCrypt(`Cold ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CC${ counter }${ suffix }`),
            healthSystemCode: `CC${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `CC${ counter }${ suffix }`,
            name: `Cold ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CC-${ suffix }-${ counter }`,
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
    // investigation and its cold chain in one go
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

    const readRow = async (id: string) => await InvestigationColdChain.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationColdChain.update({ deletedAt: at }, { where: { investigationId } });

    // The fifteen data columns of the DDL, all nullable and none of them required
    const dataColumns = [
        'storageTemperatureMonitored', 'storageRangeDeviation', 'storageProcedureFollowed',
        'storageOtherObjectPresent', 'storagePartiallyReconstitutedVaccine', 'storageVaccineNotUsable',
        'storageDiluentNotUsable', 'storageKeyFindings', 'transportUsedThermos',
        'transportSetInThermos', 'transportReturnedInThermos', 'transportUsedColdPack',
        'transportTypeThermo', 'transportKeyFindings', 'notes'
    ];

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

        it('the empty create returns 201 with the fifteen data columns in null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            for( const column of dataColumns ) {
                expect(res.body.data[column]).toBeNull();
            }
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.deletedAt).toBeNull();
            expect((await appDetailsOf(investigationId))[0].method).toBe('ESAVI-INVCOLD-001');
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
            expect(duplicate.body.code).toBe('INVCOLD_001_ALREADY_EXISTS');
            expect(duplicate.body.message).toContain(investigationId);

            // The logical seal does NOT release the slot of the primary key
            await seal(investigationId);
            expect((await create({ investigationId })).status).toBe(409);
        });

        it('an inactive or unknown investigation returns 404', async () => {
            const inactive = await createInvestigationFixture(false);
            const res = await create({ investigationId: inactive });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOLD_001_INVESTIGATION_NOT_FOUND');

            expect((await create({ investigationId: unknownUuid })).status).toBe(404);
        });

        it('trims the four free texts and stores a blank one as null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                storageKeyFindings: '  nevera con objetos ajenos  ',
                transportKeyFindings: '  sin novedad  ',
                transportTypeThermo: '  Caja fría de 5 litros  ',
                notes: '   '
            });

            expect(res.status).toBe(201);
            expect(res.body.data.storageKeyFindings).toBe('nevera con objetos ajenos');
            expect(res.body.data.transportKeyFindings).toBe('sin novedad');
            expect(res.body.data.transportTypeThermo).toBe('Caja fría de 5 litros');
            expect(res.body.data.notes).toBeNull();
        });

        it('rejects a value outside the ENUM and a transportTypeThermo over 250 characters', async () => {
            const investigationId = await createInvestigationFixture();

            const badEnum = await create({ investigationId, storageProcedureFollowed: 'MAYBE' });
            expect(badEnum.status).toBe(400);

            const tooLong = await create({ investigationId, transportTypeThermo: 'x'.repeat(251) });
            expect(tooLong.status).toBe(400);
        });

        it('does not translate between the two column types', async () => {
            const investigationId = await createInvestigationFixture();

            // An answerOption into a boolean column
            expect((await create({ investigationId, storageTemperatureMonitored: 'YES' })).status).toBe(400);
            // A boolean into an answerOption column
            expect((await create({ investigationId, transportUsedThermos: true })).status).toBe(400);
        });
    });

    describe('001 — storage block', () => {

        it('storageRangeDeviation with the flag absent is 400', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, storageRangeDeviation: true });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOLD_001_RANGE_DEVIATION_NOT_ALLOWED');
        });

        it('false counts as a value and not as an absence', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                storageTemperatureMonitored: false,
                storageRangeDeviation: false
            });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOLD_001_RANGE_DEVIATION_NOT_ALLOWED');
        });

        it('with the flag in true a false deviation is stored as false and not as null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                storageTemperatureMonitored: true,
                storageRangeDeviation: false
            });

            expect(res.status).toBe(201);
            expect(res.body.data.storageRangeDeviation).toBe(false);
        });

        it('sending it explicitly in null with the block closed is not an error', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                storageTemperatureMonitored: false,
                storageRangeDeviation: null
            });

            expect(res.status).toBe(201);
            expect(res.body.data.storageRangeDeviation).toBeNull();
        });

        it('the other six storage columns are outside the block and stay open', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                storageProcedureFollowed: 'NO',
                storageOtherObjectPresent: 'YES',
                storagePartiallyReconstitutedVaccine: 'UNKNOWN',
                storageVaccineNotUsable: 'NOT_APPLICABLE',
                storageDiluentNotUsable: 'NO_ANSWER',
                storageKeyFindings: 'todo anotado'
            });

            expect(res.status).toBe(201);
            expect(res.body.data.storageProcedureFollowed).toBe('NO');
            expect(res.body.data.storageOtherObjectPresent).toBe('YES');
            expect(res.body.data.storageDiluentNotUsable).toBe('NO_ANSWER');
            expect(res.body.data.storageKeyFindings).toBe('todo anotado');
        });
    });

    describe('002A and 002B — the dual listing', () => {

        it('a cold chain of a retired investigation is out of 002A and in 002B', async () => {
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
            await seed();

            const res = await list();
            expect(res.status).toBe(200);

            const dates = (res.body.data.rows as { createdAt: string }[]).map(row => new Date(row.createdAt).getTime());
            expect([...dates].sort((a, b) => b - a)).toEqual(dates);

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

        it('returns the row and its investigation', async () => {
            const investigationId = await seed({ storageTemperatureMonitored: true, storageRangeDeviation: false });
            const res = await getById(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.storageTemperatureMonitored).toBe(true);
            expect(res.body.data.storageRangeDeviation).toBe(false);
        });

        it('an unknown investigationId is 404', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOLD_003_NOT_FOUND');
        });

        it('a row of a retired investigation is 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await getById(investigationId, 'USER')).status).toBe(404);
            expect((await getById(investigationId, 'ADMIN')).status).toBe(404);

            const superRes = await getById(investigationId, 'SUPERADMIN');
            expect(superRes.status).toBe(200);
            expect(superRes.body.data.investigation.isActive).toBe(false);
        });

        it('a sealed row is still readable by whoever can see its investigation', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await getById(investigationId);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });

        it('the literal paths are not captured as an :id', async () => {
            // /admin is matched by its own route, which demands ADMIN — proof of the ordering
            expect((await getById('admin', 'USER')).status).toBe(403);
            expect((await getById('not-a-uuid', 'USER')).status).toBe(400);
        });
    });

    describe('006 — get by case', () => {

        it('walks the two hops and returns the object, not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, transportUsedColdPack: 'YES' });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.transportUsedColdPack).toBe('YES');
        });

        it('an unknown or inactive case is CASE_NOT_FOUND', async () => {
            const unknown = await getByCase(unknownUuid);
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('INVCOLD_006_CASE_NOT_FOUND');

            const inactiveCase = await createCaseFixture(false);
            expect((await getByCase(inactiveCase)).body.code).toBe('INVCOLD_006_CASE_NOT_FOUND');
        });

        it('a case with no visible investigation is INVESTIGATION_NOT_FOUND', async () => {
            const bare = await createCaseFixture();
            expect((await getByCase(bare)).body.code).toBe('INVCOLD_006_INVESTIGATION_NOT_FOUND');

            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId, false);
            expect((await getByCase(caseId)).body.code).toBe('INVCOLD_006_INVESTIGATION_NOT_FOUND');
        });

        it('an investigation with no cold chain yet is NOT_FOUND', async () => {
            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);

            const res = await getByCase(caseId);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCOLD_006_NOT_FOUND');
        });

        it('a retired investigation is 404 for USER and 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });
            await retireInvestigation(investigationId);

            expect((await getByCase(caseId, 'USER')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('004 — the differential update', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const investigationId = await seed({
                storageTemperatureMonitored: true,
                storageRangeDeviation: true,
                transportUsedThermos: 'YES',
                notes: 'observación inicial'
            });

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id: investigationId,
                model: InvestigationColdChain,
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
            expect(details[1].method).toBe('ESAVI-INVCOLD-004');
            expect(await versionOf(investigationId)).toBe((versionBefore ?? 0) + 1);
            expect((await readRow(investigationId))!.getDataValue('updatedAt')).not.toBeNull();
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
            expect(res.body.code).toBe('INVCOLD_004_NOT_FOUND');
        });

        it('the four free texts are trimmed before being compared', async () => {
            const investigationId = await seed({ notes: 'observación' });
            const versionBefore = await versionOf(investigationId);

            // Only surrounding blanks: nothing changed
            const res = await update(investigationId, { notes: '  observación  ' });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
        });
    });

    describe('004 — storage block', () => {

        it('closing the block leaves storageRangeDeviation in null without an error', async () => {
            const investigationId = await seed({
                storageTemperatureMonitored: true,
                storageRangeDeviation: true
            });

            const res = await update(investigationId, { storageTemperatureMonitored: false });
            expect(res.status).toBe(200);
            expect(res.body.data.storageTemperatureMonitored).toBe(false);
            expect(res.body.data.storageRangeDeviation).toBeNull();
        });

        it('closing it and sending a value in the same body is 400', async () => {
            const investigationId = await seed({
                storageTemperatureMonitored: true,
                storageRangeDeviation: true
            });

            const res = await update(investigationId, {
                storageTemperatureMonitored: false,
                storageRangeDeviation: true
            });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCOLD_004_RANGE_DEVIATION_NOT_ALLOWED');
        });

        it('sending it explicitly in null is not an error', async () => {
            const investigationId = await seed({
                storageTemperatureMonitored: true,
                storageRangeDeviation: true
            });

            const res = await update(investigationId, {
                storageTemperatureMonitored: false,
                storageRangeDeviation: null
            });
            expect(res.status).toBe(200);
            expect(res.body.data.storageRangeDeviation).toBeNull();
        });

        it('closing an already closed block writes nothing', async () => {
            const investigationId = await seed({ storageTemperatureMonitored: false });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { storageTemperatureMonitored: false });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
            expect(await appDetailsOf(investigationId)).toHaveLength(1);
        });

        it('null closes the block just like false', async () => {
            const investigationId = await seed({
                storageTemperatureMonitored: true,
                storageRangeDeviation: true
            });

            const res = await update(investigationId, { storageTemperatureMonitored: null });
            expect(res.status).toBe(200);
            expect(res.body.data.storageRangeDeviation).toBeNull();
        });

        it('with the block open a false deviation is stored as false', async () => {
            const investigationId = await seed({ storageTemperatureMonitored: true });

            const res = await update(investigationId, { storageRangeDeviation: false });
            expect(res.status).toBe(200);
            expect(res.body.data.storageRangeDeviation).toBe(false);
        });
    });

    describe('004 — the transport container exclusion', () => {

        it('conflict — both in YES in the same body is 400, on create and on update', async () => {
            const investigationId = await createInvestigationFixture();
            const created = await create({
                investigationId,
                transportUsedThermos: 'YES',
                transportUsedColdPack: 'YES'
            });
            expect(created.status).toBe(400);
            expect(created.body.code).toBe('INVCOLD_001_TRANSPORT_CONTAINER_CONFLICT');

            const seeded = await seed();
            const updated = await update(seeded, {
                transportUsedThermos: 'YES',
                transportUsedColdPack: 'YES'
            });
            expect(updated.status).toBe(400);
            expect(updated.body.code).toBe('INVCOLD_004_TRANSPORT_CONTAINER_CONFLICT');
        });

        it('relay — the cold pack from the body beats the stored thermos', async () => {
            const investigationId = await seed({ transportUsedThermos: 'YES' });

            const res = await update(investigationId, { transportUsedColdPack: 'YES' });
            expect(res.status).toBe(200);
            expect(res.body.data.transportUsedThermos).toBe('NO');
            expect(res.body.data.transportUsedColdPack).toBe('YES');
        });

        it('symmetric relay — the thermos from the body beats the stored cold pack', async () => {
            const investigationId = await seed({ transportUsedColdPack: 'YES' });

            const res = await update(investigationId, { transportUsedThermos: 'YES' });
            expect(res.status).toBe(200);
            expect(res.body.data.transportUsedColdPack).toBe('NO');
            expect(res.body.data.transportUsedThermos).toBe('YES');
        });

        // THE ONLY WAY TO COVER THE PRECEDENCE BRANCH. No operation of the API produces a row
        // with both containers in 'YES', so without seeding it by direct SQL this case would
        // never run and the branch would rot unnoticed
        it('inherited tie — over a row seeded by SQL the thermos wins by precedence', async () => {
            const investigationId = await seed();
            await InvestigationColdChain.update(
                { transportUsedThermos: 'YES', transportUsedColdPack: 'YES' },
                { where: { investigationId } }
            );

            // A PUT that only touches notes is enough: the rule runs before the diff
            const res = await update(investigationId, { notes: 'x' });
            expect(res.status).toBe(200);
            expect(res.body.data.transportUsedThermos).toBe('YES');
            expect(res.body.data.transportUsedColdPack).toBe('NO');
        });

        it('no combination without two YES forces anything', async () => {
            const investigationId = await seed({ transportUsedColdPack: 'YES' });

            const res = await update(investigationId, { transportUsedThermos: 'NO' });
            expect(res.status).toBe(200);
            expect(res.body.data.transportUsedColdPack).toBe('YES');
            expect(res.body.data.transportUsedThermos).toBe('NO');
        });

        it('resending NO over a row that already had NO writes nothing', async () => {
            const investigationId = await seed({ transportUsedColdPack: 'NO' });
            const versionBefore = await versionOf(investigationId);

            const res = await update(investigationId, { transportUsedColdPack: 'NO' });
            expect(res.status).toBe(200);
            expect(await versionOf(investigationId)).toBe(versionBefore);
        });

        // The case that breaks if somebody later hangs the three columns from transportUsedThermos
        it('the three container columns are stored with both flags in NO and with both in null', async () => {
            const withNo = await seed({ transportUsedThermos: 'NO', transportUsedColdPack: 'NO' });
            const a = await update(withNo, {
                transportSetInThermos: 'YES',
                transportReturnedInThermos: 'NO',
                transportTypeThermo: '  Caja fría  '
            });
            expect(a.status).toBe(200);
            expect(a.body.data.transportSetInThermos).toBe('YES');
            expect(a.body.data.transportReturnedInThermos).toBe('NO');
            expect(a.body.data.transportTypeThermo).toBe('Caja fría');

            const bare = await seed();
            const b = await update(bare, {
                transportSetInThermos: 'UNKNOWN',
                transportReturnedInThermos: 'NO_ANSWER',
                transportTypeThermo: 'Termo de 3 litros'
            });
            expect(b.status).toBe(200);
            expect(b.body.data.transportUsedThermos).toBeNull();
            expect(b.body.data.transportUsedColdPack).toBeNull();
            expect(b.body.data.transportSetInThermos).toBe('UNKNOWN');
            expect(b.body.data.transportReturnedInThermos).toBe('NO_ANSWER');
            expect(b.body.data.transportTypeThermo).toBe('Termo de 3 litros');
        });
    });

    describe('005C — physical delete', () => {

        it('a row with no deletedAt is 409', async () => {
            const investigationId = await seed();

            const res = await purge(investigationId);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVCOLD_005C_NOT_DELETED');
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
            const investigationId = await seed({ transportTypeThermo: 'Termo de 3 litros', notes: 'Ibarra' });
            await seal(investigationId);
            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;

            expect((await purge(investigationId)).status).toBe(200);

            const written = fs.readFileSync(logPath, 'utf8').slice(logBefore);
            expect(written).toContain('ESAVI-INVCOLD-005C');
            expect(written).toMatch(/WARN/i);
            expect(written).toContain(investigationId);
            expect(written).toContain('Termo de 3 litros');
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
    // accesses, found through both listings with each filter, completed by the update and finally
    // destroyed. The blocks above check each operation in isolation and its error paths; this one
    // checks that the seven of them compose over ONE row, which is how the entity is actually used
    // — the cold chain is opened when the investigation starts and filled in over the days after
    describe('the seven operations over one row', () => {

        it('walks create, read, list, update and purge end to end', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);

            // 001 — opened empty
            const created = await create({ investigationId });
            expect(created.status).toBe(201);
            for( const column of dataColumns ) {
                expect(created.body.data[column]).toBeNull();
            }

            // 003 and 006 — the two reads reach the same row
            expect((await getById(investigationId)).body.data.investigationId).toBe(investigationId);
            expect((await getByCase(caseId)).body.data.investigationId).toBe(investigationId);

            // 002A and 002B — found through both listings, by each filter
            expect((await list(`?investigationId=${ investigationId }`)).body.data.count).toBe(1);
            expect((await listAdmin(`?caseId=${ caseId }`)).body.data.count).toBe(1);

            // 004 — the form is filled in over two saves
            const first = await update(investigationId, {
                storageTemperatureMonitored: true,
                storageRangeDeviation: true,
                storageProcedureFollowed: 'NO',
                storageKeyFindings: '  nevera sin termómetro  '
            });
            expect(first.status).toBe(200);
            expect(first.body.data.storageKeyFindings).toBe('nevera sin termómetro');

            const second = await update(investigationId, {
                transportUsedThermos: 'YES',
                transportSetInThermos: 'YES',
                transportReturnedInThermos: 'NO',
                transportTypeThermo: 'Termo de 3 litros',
                notes: 'cadena de frío auditada'
            });
            expect(second.status).toBe(200);
            expect(second.body.data.transportUsedThermos).toBe('YES');
            expect(second.body.data.notes).toBe('cadena de frío auditada');

            // Two updates over one create: three entries and no more
            expect(await appDetailsOf(investigationId)).toHaveLength(3);

            // The change of container: the relay leaves the thermos in NO
            const third = await update(investigationId, { transportUsedColdPack: 'YES' });
            expect(third.body.data.transportUsedThermos).toBe('NO');
            expect(third.body.data.transportUsedColdPack).toBe('YES');
            // And the three container columns survive the change untouched
            expect(third.body.data.transportSetInThermos).toBe('YES');
            expect(third.body.data.transportTypeThermo).toBe('Termo de 3 litros');

            // 005A of the parent seals it, 005B gives it back
            await request(app).delete(`/api/investigations/${ investigationId }`)
                .set(authHeader('ADMIN')).expect(200);
            expect((await readRow(investigationId))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await getById(investigationId)).status).toBe(404);

            await request(app).patch(`/api/investigations/activate/${ investigationId }`)
                .set(authHeader('SUPERADMIN')).expect(200);
            expect((await readRow(investigationId))!.getDataValue('deletedAt')).toBeNull();
            expect((await getById(investigationId)).status).toBe(200);

            // 005C — sealed again and destroyed
            await seal(investigationId);
            expect((await purge(investigationId)).status).toBe(200);
            expect(await readRow(investigationId)).toBeNull();
        });
    });
});
