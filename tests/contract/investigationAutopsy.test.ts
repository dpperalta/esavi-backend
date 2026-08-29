import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationAutopsy, InvestigationSource, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationAutopsy operations of SPEC F30. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access
 * by case, and the four coherence rules evaluated over the resulting state.
 *
 * Three things separate this entity from its sister F29 and get deliberate coverage:
 *
 *  - It is the first satellite with REQUIRED fields. isDeath must travel and must be
 *    strictly true, and deathDate must travel: the row is not a draft, it is the record
 *    of a fact with a date. isDeath is then immutable, ignored in silence rather than
 *    rejected, and deathDate is modifiable but not erasable.
 *  - deathTime is the first `time` column of the repository. Postgres reads back
 *    '14:30:00' where a form sends '14:30', so without normalization every open of the
 *    screen would write an entry for a datum nobody touched.
 *  - The coherence rules cross two dates, and one of them can fire with NEITHER date
 *    travelling in the body: correcting the deathDate alone is enough to leave a stored
 *    autopsyDate behind it.
 *
 * The false gets deliberate coverage of its own: an `if( data.x )` in the service would
 * make it impossible to store the answer "no autopsy was performed" — half the domain of
 * the two flags — while still answering 200.
 */
describe('investigationAutopsy contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    let statusZeroItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // Every fixture is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Autopsy ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`IA${ counter }${ suffix }`),
            healthSystemCode: `IA${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `IA${ counter }${ suffix }`,
            name: `Autopsy ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `IA-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    // statusItemId is passed explicitly: an investigation created straight through the model
    // skips the service of F28 that resolves the default status, and its `status` would come
    // back null — which this suite asserts never happens
    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> => {
        const caseId = await createCaseFixture();
        const investigation = await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive });
        return investigation.getDataValue('investigationId');
    };

    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post('/api/investigation-autopsies').set(authHeader(role)).send(payload);

    // The minimum create of this entity, and the difference with F13, F14 and F29: there is no
    // empty create here. Mints an investigation and its autopsy in one go, and hands back the
    // shared id
    const seedAutopsy = async (payload: Record<string, unknown> = {}): Promise<string> => {
        const investigationId = await createInvestigationFixture();
        const res = await create({ investigationId, isDeath: true, deathDate: '2024-06-01', ...payload });
        expect(res.status).toBe(201);
        return investigationId;
    };

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-autopsies/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-autopsies/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-autopsies${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`/api/investigation-autopsies/admin${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`/api/investigation-autopsies/${ id }`).set(authHeader(role)).send(payload);

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`/api/investigation-autopsies/purge/${ id }`).set(authHeader(role));

    const readRow = async (id: string) => await InvestigationAutopsy.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationAutopsy.update({ deletedAt: at }, { where: { investigationId } });

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        statusZeroItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '0' }
        }))!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('the minimal create returns 201 with the seven remaining columns null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isDeath: true, deathDate: '2024-06-01' });

            expect(res.status).toBe(201);
            const { data } = res.body;
            expect(data.investigationId).toBe(investigationId);
            expect(data.isDeath).toBe(true);
            expect(data.deathDate).toBe('2024-06-01');

            for( const column of ['deathTime', 'isAutopsyPerformed', 'isAutopsyScheduled',
                'autopsyDate', 'scheduledAutopsyDate', 'autopsyComments', 'notes'] ) {
                expect(data[column]).toBeNull();
            }

            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVAUT-001');
        });

        it('returns the full shape, with the investigation resolved and no sysDetails', async () => {
            const id = await seedAutopsy();
            const { data } = (await getById(id)).body;

            expect(data.isActive).toBeUndefined();
            expect(data.sysDetails).toBeUndefined();
            expect(data.investigation.sysDetails).toBeUndefined();
            expect(data.investigation.status).not.toBeNull();
            expect(data.investigation.status.catalogItemId).toBeDefined();
            expect(data.investigation.case.caseId).toBeDefined();
        });

        it('normalizes deathTime to HH:mm:ss and trims both texts', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isDeath: true, deathDate: '2024-06-01',
                deathTime: '14:30', autopsyComments: '  a comment  ', notes: '   '
            });

            expect(res.body.data.deathTime).toBe('14:30:00');
            expect(res.body.data.autopsyComments).toBe('a comment');
            expect(res.body.data.notes).toBeNull();
        });

        it('a missing isDeath is 400, and isDeath false is 400', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, deathDate: '2024-06-01' })).status).toBe(400);
            expect((await create({ investigationId, isDeath: false, deathDate: '2024-06-01' })).status).toBe(400);
        });

        it('a missing deathDate is 400, and a future one too', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, isDeath: true })).status).toBe(400);
            expect((await create({ investigationId, isDeath: true, deathDate: tomorrow })).status).toBe(400);
        });

        it('a future autopsyDate is 400, but a future scheduledAutopsyDate is 201', async () => {
            const a = await createInvestigationFixture();
            expect((await create({
                investigationId: a, isDeath: true, deathDate: '2024-06-01',
                isAutopsyPerformed: true, autopsyDate: tomorrow
            })).status).toBe(400);

            const b = await createInvestigationFixture();
            expect((await create({
                investigationId: b, isDeath: true, deathDate: '2024-06-01',
                isAutopsyScheduled: true, scheduledAutopsyDate: tomorrow
            })).status).toBe(201);
        });

        it('an unknown investigation is 404, and an inactive one too', async () => {
            expect((await create({
                investigationId: unknownUuid, isDeath: true, deathDate: '2024-06-01'
            })).status).toBe(404);

            const inactive = await createInvestigationFixture(false);
            const res = await create({ investigationId: inactive, isDeath: true, deathDate: '2024-06-01' });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVAUT_001_INVESTIGATION_NOT_FOUND');
        });

        it('a second autopsy over the same investigation is 409, with the id interpolated', async () => {
            const id = await seedAutopsy();
            const res = await create({ investigationId: id, isDeath: true, deathDate: '2024-06-02' });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVAUT_001_ALREADY_EXISTS');
            expect(res.body.message).toContain(id);
        });

        it('a SEALED autopsy still occupies the slot: 409 too', async () => {
            const id = await seedAutopsy();
            await seal(id);

            const res = await create({ investigationId: id, isDeath: true, deathDate: '2024-06-02' });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVAUT_001_ALREADY_EXISTS');
        });
    });

    describe('001 — the four coherence rules, strict variant', () => {

        it('both flags true is 400 FLAGS_EXCLUSIVE', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isDeath: true, deathDate: '2024-06-01',
                isAutopsyPerformed: true, isAutopsyScheduled: true
            });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVAUT_001_AUTOPSY_FLAGS_EXCLUSIVE');
        });

        it('both flags false, both null, or one of each are all valid', async () => {
            const combinations = [
                { isAutopsyPerformed: false, isAutopsyScheduled: false },
                { isAutopsyPerformed: null, isAutopsyScheduled: null },
                { isAutopsyPerformed: false, isAutopsyScheduled: null }
            ];
            for( const flags of combinations ) {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isDeath: true, deathDate: '2024-06-01', ...flags });
                expect(res.status).toBe(201);
            }
        });

        it('a date under a flag that is not true is 400 — false and null alike', async () => {
            const a = await createInvestigationFixture();
            const resA = await create({
                investigationId: a, isDeath: true, deathDate: '2024-06-01',
                isAutopsyPerformed: false, autopsyDate: '2024-06-02'
            });
            expect(resA.status).toBe(400);
            expect(resA.body.code).toBe('INVAUT_001_AUTOPSY_DATE_NOT_ALLOWED');

            const b = await createInvestigationFixture();
            const resB = await create({
                investigationId: b, isDeath: true, deathDate: '2024-06-01',
                isAutopsyScheduled: null, scheduledAutopsyDate: '2024-06-02'
            });
            expect(resB.status).toBe(400);
            expect(resB.body.code).toBe('INVAUT_001_SCHEDULED_AUTOPSY_DATE_NOT_ALLOWED');
        });

        it('a true flag WITHOUT its date is 201: the date can be completed later', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isDeath: true, deathDate: '2024-06-01', isAutopsyPerformed: true
            });
            expect(res.status).toBe(201);
            expect(res.body.data.autopsyDate).toBeNull();
        });

        it('an autopsyDate earlier than the deathDate is 400, with both dates interpolated', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isDeath: true, deathDate: '2024-06-10',
                isAutopsyPerformed: true, autopsyDate: '2024-06-01'
            });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVAUT_001_AUTOPSY_DATE_BEFORE_DEATH');
            expect(res.body.message).toContain('2024-06-01');
            expect(res.body.message).toContain('2024-06-10');
        });

        it('a scheduledAutopsyDate BEFORE the death is valid: it carries no temporal rule', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isDeath: true, deathDate: '2024-06-10',
                isAutopsyScheduled: true, scheduledAutopsyDate: '2024-06-01'
            });
            expect(res.status).toBe(201);
            expect(res.body.data.scheduledAutopsyDate).toBe('2024-06-01');
        });
    });

    describe('003 — get by id', () => {

        it('an unknown id is 404 and a non-uuid one is 400', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVAUT_003_NOT_FOUND');
            expect((await getById('not-a-uuid')).status).toBe(400);
        });

        it('an inactive investigation is 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const id = await seedAutopsy();
            await retireInvestigation(id);

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'ADMIN')).status).toBe(404);

            const superadmin = await getById(id, 'SUPERADMIN');
            expect(superadmin.status).toBe(200);
            expect(superadmin.body.data.investigation.isActive).toBe(false);
        });

        it('a sealed deletedAt does not hide the row while its investigation is active', async () => {
            const id = await seedAutopsy();
            await seal(id);

            const res = await getById(id);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });
    });

    describe('006 — get by case', () => {

        it('returns the object itself, not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, isDeath: true, deathDate: '2024-06-01' });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(false);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('the three 404 carry three distinct codes', async () => {
            const unknownCase = await getByCase(unknownUuid);
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('INVAUT_006_CASE_NOT_FOUND');

            const orphanCase = await createCaseFixture();
            const noInvestigation = await getByCase(orphanCase);
            expect(noInvestigation.status).toBe(404);
            expect(noInvestigation.body.code).toBe('INVAUT_006_INVESTIGATION_NOT_FOUND');

            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);
            const noAutopsy = await getByCase(caseId);
            expect(noAutopsy.status).toBe(404);
            expect(noAutopsy.body.code).toBe('INVAUT_006_NOT_FOUND');

            const codes = [unknownCase.body.code, noInvestigation.body.code, noAutopsy.body.code];
            expect(new Set(codes).size).toBe(3);
        });

        it('an inactive case cuts at the first link', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, isDeath: true, deathDate: '2024-06-01' });
            await EsaviCase.update({ isActive: false }, { where: { caseId } });

            const res = await getByCase(caseId);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVAUT_006_CASE_NOT_FOUND');
        });

        it('an inactive investigation is 404 for USER and 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, isDeath: true, deathDate: '2024-06-01' });
            await retireInvestigation(investigationId);

            const asUser = await getByCase(caseId);
            expect(asUser.status).toBe(404);
            expect(asUser.body.code).toBe('INVAUT_006_INVESTIGATION_NOT_FOUND');
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

        it('a non-uuid caseId is 400: /case is not captured as an :id', async () => {
            expect((await getByCase('not-a-uuid')).status).toBe(400);
        });
    });

    describe('002A and 002B — the dual listing', () => {

        it('/ hides autopsies of inactive investigations and /admin shows them', async () => {
            const visible = await seedAutopsy();
            const hidden = await seedAutopsy();
            await retireInvestigation(hidden);

            const publicIds = (await list('?limit=100')).body.data.rows
                .map((r: { investigationId: string }) => r.investigationId);
            expect(publicIds).toContain(visible);
            expect(publicIds).not.toContain(hidden);

            const adminIds = (await listAdmin('?limit=100')).body.data.rows
                .map((r: { investigationId: string }) => r.investigationId);
            expect(adminIds).toContain(visible);
            expect(adminIds).toContain(hidden);
        });

        it('a USER gets 403 on /admin', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });

        it('a filter with an unknown UUID answers 200 with count 0', async () => {
            const res = await list(`?investigationId=${ unknownUuid }`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ count: 0, rows: [] });
            expect((await list(`?caseId=${ unknownUuid }`)).body.data.count).toBe(0);
        });

        it('the two filters combine with AND, and caseId resolves through the include', async () => {
            const caseA = await createCaseFixture();
            const investigationA = await createInvestigationForCase(caseA);
            await create({ investigationId: investigationA, isDeath: true, deathDate: '2024-06-03' });

            const caseB = await createCaseFixture();
            const investigationB = await createInvestigationForCase(caseB);
            await create({ investigationId: investigationB, isDeath: true, deathDate: '2024-06-04' });

            const byCase = await list(`?caseId=${ caseA }`);
            expect(byCase.body.data.count).toBe(1);
            expect(byCase.body.data.rows[0].investigationId).toBe(investigationA);

            const matching = await list(`?investigationId=${ investigationA }&caseId=${ caseA }`);
            expect(matching.body.data.count).toBe(1);

            // Crossed pair: each one exists, the intersection does not
            expect((await list(`?investigationId=${ investigationA }&caseId=${ caseB }`)).body.data.count).toBe(0);
        });

        it('the rows carry the same full shape as the 003, with no isActive and no sysDetails', async () => {
            const id = await seedAutopsy({ notes: 'listed' });
            const row = (await list(`?investigationId=${ id }`)).body.data.rows[0];

            for( const key of ['isDeath', 'deathDate', 'deathTime', 'isAutopsyPerformed',
                'isAutopsyScheduled', 'autopsyDate', 'scheduledAutopsyDate', 'autopsyComments',
                'notes', 'appDetails'] ) {
                expect(row).toHaveProperty(key);
            }
            expect(row.isActive).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
            expect(row.investigation.sysDetails).toBeUndefined();
            expect(row.investigation.status).not.toBeNull();
        });

        it('?limit=2 returns two rows with the total count', async () => {
            await seedAutopsy();
            await seedAutopsy();
            await seedAutopsy();

            const res = await list('?limit=2');
            expect(res.body.data.rows).toHaveLength(2);
            expect(res.body.data.count).toBeGreaterThan(2);
        });

        it('the order leads by deathDate descending, with createdAt breaking the tie', async () => {
            const dates = (await list('?limit=100')).body.data.rows
                .map((r: { deathDate: string }) => r.deathDate);
            expect(dates).toEqual([...dates].sort().reverse());
        });
    });

    describe('004 — the differential update', () => {

        it('a PUT that resends the whole GET response writes nothing', async () => {
            const id = await seedAutopsy({
                deathTime: '14:30', isAutopsyPerformed: true, autopsyDate: '2024-06-05',
                autopsyComments: 'a comment', notes: 'a note'
            });
            await expectPutOfGetResponseWritesNothing({
                path: '/api/investigation-autopsies',
                id,
                model: InvestigationAutopsy,
                role: 'USER'
            });
        });

        it('an empty body behaves the same way', async () => {
            const id = await seedAutopsy({ notes: 'a note' });
            const versionBefore = await versionOf(id);
            const before = await appDetailsOf(id);

            expect((await update(id, {})).status).toBe(200);
            expect(await appDetailsOf(id)).toHaveLength(before.length);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('changing one field adds ONE entry and bumps the version by 1', async () => {
            const id = await seedAutopsy();
            const versionBefore = await versionOf(id);
            const before = await appDetailsOf(id);

            const res = await update(id, { notes: 'a new note' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('a new note');

            const after = await appDetailsOf(id);
            expect(after).toHaveLength(before.length + 1);
            expect(after[after.length - 1].method).toBe('ESAVI-INVAUT-004');
            expect(await versionOf(id)).toBe((versionBefore ?? 0) + 1);
            expect((await readRow(id))!.getDataValue('updatedAt')).not.toBeNull();
        });

        it('false is stored and null empties it — neither flag goes under an if( data.x )', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true });
            expect((await update(id, { isAutopsyPerformed: false })).body.data.isAutopsyPerformed).toBe(false);
            expect((await update(id, { isAutopsyPerformed: null })).body.data.isAutopsyPerformed).toBeNull();

            const other = await seedAutopsy({ isAutopsyScheduled: true });
            expect((await update(other, { isAutopsyScheduled: false })).body.data.isAutopsyScheduled).toBe(false);
        });

        it('deathTime without seconds over a stored HH:mm:ss writes nothing', async () => {
            const id = await seedAutopsy({ deathTime: '14:30:00' });
            const versionBefore = await versionOf(id);

            const res = await update(id, { deathTime: '14:30' });
            expect(res.status).toBe(200);
            expect(res.body.data.deathTime).toBe('14:30:00');
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('a text differing only in surrounding blanks writes nothing, and "" empties it', async () => {
            const id = await seedAutopsy({ notes: 'a note' });
            const versionBefore = await versionOf(id);

            expect((await update(id, { notes: '  a note  ' })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
            expect((await update(id, { notes: '' })).body.data.notes).toBeNull();
        });

        it('resending the three dates as the GET returned them writes nothing', async () => {
            const id = await seedAutopsy({ isAutopsyScheduled: true, scheduledAutopsyDate: '2024-07-01' });
            const before = await getById(id);
            const versionBefore = await versionOf(id);

            const res = await update(id, {
                deathDate: before.body.data.deathDate,
                scheduledAutopsyDate: before.body.data.scheduledAutopsyDate
            });
            expect(res.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('an unknown id is 404, and an inactive investigation is 404 for USER, 200 for SUPERADMIN', async () => {
            expect((await update(unknownUuid, { notes: 'x' })).status).toBe(404);

            const id = await seedAutopsy();
            await retireInvestigation(id);
            expect((await update(id, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await update(id, { notes: 'y' }, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('004 — immutable and required fields', () => {

        it('investigationId and isDeath are ignored in silence, without writing', async () => {
            const id = await seedAutopsy();
            const other = await createInvestigationFixture();
            const versionBefore = await versionOf(id);

            const res = await update(id, { investigationId: other, isDeath: false });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(id);
            expect(res.body.data.isDeath).toBe(true);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('deathDate null is 400, a different valid date is 200, a future one is 400', async () => {
            const id = await seedAutopsy();
            expect((await update(id, { deathDate: null })).status).toBe(400);
            expect((await update(id, { deathDate: tomorrow })).status).toBe(400);

            const res = await update(id, { deathDate: '2024-06-02' });
            expect(res.status).toBe(200);
            expect(res.body.data.deathDate).toBe('2024-06-02');
        });
    });

    describe('004 — the four coherence rules over the resulting state', () => {

        it('one flag travelling against the STORED other one is 400 FLAGS_EXCLUSIVE', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true });
            const res = await update(id, { isAutopsyScheduled: true });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVAUT_004_AUTOPSY_FLAGS_EXCLUSIVE');
        });

        it('switching a flag off clears its date in the SAME request, with ONE entry', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            const before = await appDetailsOf(id);

            const res = await update(id, { isAutopsyPerformed: false });
            expect(res.status).toBe(200);
            expect(res.body.data.isAutopsyPerformed).toBe(false);
            expect(res.body.data.autopsyDate).toBeNull();
            expect(await appDetailsOf(id)).toHaveLength(before.length + 1);
        });

        it('switching off a flag that was ALREADY off writes nothing', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: false });
            const versionBefore = await versionOf(id);

            expect((await update(id, { isAutopsyPerformed: false })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('a body that switches the flag off and dates the autopsy is 400', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            const res = await update(id, { isAutopsyPerformed: false, autopsyDate: '2024-06-06' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVAUT_004_AUTOPSY_DATE_NOT_ALLOWED');
        });

        it('sending the date as null while switching off is NOT an error', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            const res = await update(id, { isAutopsyPerformed: false, autopsyDate: null });
            expect(res.status).toBe(200);
            expect(res.body.data.autopsyDate).toBeNull();
        });

        it('the same rule holds for the scheduled pair', async () => {
            const id = await seedAutopsy({ isAutopsyScheduled: true, scheduledAutopsyDate: '2024-07-01' });

            const contradictory = await update(id, { isAutopsyScheduled: false, scheduledAutopsyDate: '2024-07-02' });
            expect(contradictory.status).toBe(400);
            expect(contradictory.body.code).toBe('INVAUT_004_SCHEDULED_AUTOPSY_DATE_NOT_ALLOWED');

            const res = await update(id, { isAutopsyScheduled: false });
            expect(res.status).toBe(200);
            expect(res.body.data.scheduledAutopsyDate).toBeNull();
        });

        it('switching a flag ON over a row that already carries its date is coherent', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            await update(id, { isAutopsyPerformed: null, autopsyDate: null });

            const res = await update(id, { isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            expect(res.status).toBe(200);
            expect(res.body.data.autopsyDate).toBe('2024-06-05');
        });

        it('moving the deathDate behind a STORED autopsyDate is 400 without the date travelling', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            const res = await update(id, { deathDate: '2024-06-10' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVAUT_004_AUTOPSY_DATE_BEFORE_DEATH');
        });

        it('the same move while switching the flag off is 200: the date is erased anyway', async () => {
            const id = await seedAutopsy({ isAutopsyPerformed: true, autopsyDate: '2024-06-05' });
            const res = await update(id, { isAutopsyPerformed: false, deathDate: '2024-06-10' });
            expect(res.status).toBe(200);
            expect(res.body.data.autopsyDate).toBeNull();
            expect(res.body.data.deathDate).toBe('2024-06-10');
        });

        it('a scheduledAutopsyDate before the death is 200: it stays out of that rule', async () => {
            const id = await seedAutopsy();
            const res = await update(id, { isAutopsyScheduled: true, scheduledAutopsyDate: '2024-05-01' });
            expect(res.status).toBe(200);
            expect(res.body.data.scheduledAutopsyDate).toBe('2024-05-01');
        });
    });

    describe('005C — purge', () => {

        it('purging an UNSEALED autopsy is 409 notDeleted, and the row survives', async () => {
            const id = await seedAutopsy();
            const res = await purge(id);

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVAUT_005C_NOT_DELETED');
            expect(res.body.message).toContain(id);
            expect(await readRow(id)).not.toBeNull();
        });

        it('a sealed autopsy is purged: 200 without data, and repeating is 404', async () => {
            const id = await seedAutopsy();
            await seal(id);

            const res = await purge(id);
            expect(res.status).toBe(200);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(id)).toBeNull();
            expect((await purge(id)).status).toBe(404);
        });

        it('purging releases the investigationId: a later POST is 201', async () => {
            const id = await seedAutopsy();
            await seal(id);
            await purge(id);

            expect((await create({ investigationId: id, isDeath: true, deathDate: '2024-07-01' })).status).toBe(201);
        });

        it('an ADMIN gets 403 and an unknown id is 404', async () => {
            const id = await seedAutopsy();
            await seal(id);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
            expect((await purge(unknownUuid)).status).toBe(404);
        });

        it('the row is purgable under a retired investigation, which survives', async () => {
            const id = await seedAutopsy();
            await seal(id);
            await retireInvestigation(id);

            expect((await purge(id)).status).toBe(200);
            expect(await readRow(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('purging the autopsy does not touch the investigationSource of the same investigation', async () => {
            const id = await seedAutopsy();
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await seal(id);

            expect((await purge(id)).status).toBe(200);
            expect(await readRow(id)).toBeNull();
            expect(await InvestigationSource.findByPk(id, { paranoid: false })).not.toBeNull();
        });
    });

    describe('the operations that do not exist', () => {

        it('DELETE /:id and PATCH /activate/:id are both 404 from Express', async () => {
            const id = await seedAutopsy();

            const softDelete = await request(app)
                .delete(`/api/investigation-autopsies/${ id }`).set(authHeader('SUPERADMIN'));
            expect(softDelete.status).toBe(404);

            const activate = await request(app)
                .patch(`/api/investigation-autopsies/activate/${ id }`).set(authHeader('SUPERADMIN'));
            expect(activate.status).toBe(404);
        });
    });
});
