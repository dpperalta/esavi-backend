import fs from 'fs';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationSource, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationSource operations of SPEC F29. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access
 * by case, the coherence rule of the "other" source evaluated over the resulting state,
 * and the differential update — the main operation of an entity whose ten data columns
 * are all nullable.
 *
 * The false gets deliberate coverage of its own: eight of the ten columns are booleans,
 * and an `if( data.x )` in the service would make it impossible to store the answer
 * "this source was not used" — half the domain of the entity — while still answering 200.
 */
describe('investigationSource contract', () => {

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
            firstName: esaviCrypt(`Source ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`IS${ counter }${ suffix }`),
            healthSystemCode: `IS${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `IS${ counter }${ suffix }`,
            name: `Source ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `IS-${ suffix }-${ counter }`,
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
        request(app).post('/api/investigation-sources').set(authHeader(role)).send(payload);

    // Mints an investigation and its source in one go, and hands back the shared id
    const seedSource = async (payload: Record<string, unknown> = {}): Promise<string> => {
        const investigationId = await createInvestigationFixture();
        const res = await create({ investigationId, ...payload });
        expect(res.status).toBe(201);
        return investigationId;
    };

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-sources/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-sources/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-sources${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`/api/investigation-sources/admin${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`/api/investigation-sources/${ id }`).set(authHeader(role)).send(payload);

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`/api/investigation-sources/purge/${ id }`).set(authHeader(role));

    const readRow = async (id: string) => await InvestigationSource.findByPk(id, { paranoid: false });

    const versionOf = (row: InvestigationSource) =>
        (row.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationSource.update({ deletedAt: at }, { where: { investigationId } });

    const theEightSources = [
        'history', 'interviewVaccinatedPerson', 'interviewHealthWorker', 'vaccinationRecord',
        'autopsyRecord', 'verbalAutopsyRecord', 'investigationReport', 'other'
    ];

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

        it('opens the row with the ten data columns null and returns the full shape', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            const data = res.body.data;
            expect(data.investigationId).toBe(investigationId);

            // A create with the ten data columns empty is valid: it is the normal way of opening
            // the row and completing it with the PUT
            for( const field of [...theEightSources, 'otherDescription', 'notes'] ) {
                expect(data[field]).toBeNull();
            }
            expect(data.deletedAt).toBeNull();

            // The table has no isActive, and sysDetails never leaves the service
            expect(data.isActive).toBeUndefined();
            expect(data.sysDetails).toBeUndefined();

            // The investigation travels resolved, and its status is never null
            expect(data.investigation.investigationId).toBe(investigationId);
            expect(data.investigation.status).not.toBeNull();
            expect(data.investigation.status.catalogItemId).toBe(statusZeroItemId);
            expect(data.investigation.case.caseId).toBeDefined();
            expect(data.investigation.sysDetails).toBeUndefined();

            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVSRC-001');
        });

        it('stores false as false and trims the free texts', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                history: false,
                interviewHealthWorker: true,
                notes: '   Sin novedad   '
            });

            expect(res.status).toBe(201);
            expect(res.body.data.history).toBe(false);
            expect(res.body.data.interviewHealthWorker).toBe(true);
            expect(res.body.data.vaccinationRecord).toBeNull();
            expect(res.body.data.notes).toBe('Sin novedad');
        });

        it('answers 404 when the investigation does not exist or is inactive', async () => {
            const unknown = await create({ investigationId: unknownUuid });
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('INVSRC_001_INVESTIGATION_NOT_FOUND');

            const inactiveId = await createInvestigationFixture(false);
            const inactive = await create({ investigationId: inactiveId });
            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('INVSRC_001_INVESTIGATION_NOT_FOUND');
        });

        it('answers 409 on the second source of the same investigation', async () => {
            const investigationId = await seedSource();

            const res = await create({ investigationId });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVSRC_001_ALREADY_EXISTS');
            expect(res.body.message).toContain(investigationId);
        });

        it('answers 409 too when the existing source is sealed: the seal does not free the slot', async () => {
            const investigationId = await seedSource();
            await seal(investigationId);

            const res = await create({ investigationId });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVSRC_001_ALREADY_EXISTS');
        });

        it('is strict about the other source rule', async () => {
            const investigationId = await createInvestigationFixture();

            const missing = await create({ investigationId, other: true });
            expect(missing.status).toBe(400);
            expect(missing.body.code).toBe('INVSRC_001_OTHER_DESCRIPTION_REQUIRED');

            // Blank after trimming is no description at all
            const blank = await create({ investigationId, other: true, otherDescription: '   ' });
            expect(blank.status).toBe(400);
            expect(blank.body.code).toBe('INVSRC_001_OTHER_DESCRIPTION_REQUIRED');

            // On create there is no inherited state to clean, so a description under a non-true
            // answer is rejected instead of silently dropped
            const notAllowed = await create({ investigationId, other: false, otherDescription: 'Acta' });
            expect(notAllowed.status).toBe(400);
            expect(notAllowed.body.code).toBe('INVSRC_001_OTHER_DESCRIPTION_NOT_ALLOWED');

            const ok = await create({ investigationId, other: true, otherDescription: '  Acta externa  ' });
            expect(ok.status).toBe(201);
            expect(ok.body.data.otherDescription).toBe('Acta externa');
        });

        it('rejects a malformed body with 400', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, history: 'si' })).status).toBe(400);
            expect((await create({})).status).toBe(400);
        });
    });

    describe('002A and 002B — the dual listing', () => {

        let activeId: string;
        let activeCaseId: string;
        let retiredId: string;

        beforeAll(async () => {
            activeCaseId = await createCaseFixture();
            activeId = await createInvestigationForCase(activeCaseId);
            await create({ investigationId: activeId, history: false, notes: 'visible' });

            // Created while the investigation was active, retired afterwards
            retiredId = await seedSource({ history: true });
            await Investigation.update({ isActive: false }, { where: { investigationId: retiredId } });
        });

        it('hides the source of a retired investigation from 002A and shows it in 002B', async () => {
            const publicList = await list(`?investigationId=${ retiredId }`);
            expect(publicList.status).toBe(200);
            expect(publicList.body.data.count).toBe(0);
            expect(publicList.body.data.rows).toEqual([]);

            const adminList = await listAdmin(`?investigationId=${ retiredId }`);
            expect(adminList.status).toBe(200);
            expect(adminList.body.data.count).toBe(1);
            expect(adminList.body.data.rows[0].investigation.isActive).toBe(false);
        });

        it('refuses /admin to a USER', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });

        it('answers 200 with count 0 for a filter naming a UUID that does not exist', async () => {
            expect((await list(`?investigationId=${ unknownUuid }`)).body.data.count).toBe(0);
            expect((await list(`?caseId=${ unknownUuid }`)).body.data.count).toBe(0);
        });

        it('combines the two filters with AND', async () => {
            const matching = await list(`?investigationId=${ activeId }&caseId=${ activeCaseId }`);
            expect(matching.body.data.count).toBe(1);

            // Right investigation, wrong case: with AND nothing matches
            const otherCaseId = await createCaseFixture();
            const crossed = await list(`?investigationId=${ activeId }&caseId=${ otherCaseId }`);
            expect(crossed.body.data.count).toBe(0);
        });

        it('resolves the caseId filter through the investigation include', async () => {
            const byCase = await list(`?caseId=${ activeCaseId }`);
            expect(byCase.body.data.count).toBe(1);
            expect(byCase.body.data.rows[0].investigationId).toBe(activeId);
        });

        it('returns the same full shape as the 003, with no reduced variant', async () => {
            const row = (await list(`?investigationId=${ activeId }`)).body.data.rows[0];

            for( const field of [...theEightSources, 'otherDescription', 'notes'] ) {
                expect(row).toHaveProperty(field);
            }
            expect(row.history).toBe(false);
            expect(row.notes).toBe('visible');
            expect(row.appDetails).toBeDefined();
            expect(row.createdAt).toBeDefined();

            expect(row.isActive).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
            expect(row.investigation.sysDetails).toBeUndefined();
            expect(row.investigation.status).not.toBeNull();
        });

        it('paginates while keeping the total count', async () => {
            const res = await listAdmin('?limit=1');
            expect(res.body.data.rows).toHaveLength(1);
            expect(res.body.data.count).toBeGreaterThanOrEqual(2);
        });

        it('rejects a malformed filter with 400', async () => {
            expect((await list('?caseId=no-es-uuid')).status).toBe(400);
            expect((await list('?limit=muchos')).status).toBe(400);
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape, and the :id is the investigationId', async () => {
            const id = await seedSource({ history: false, other: true, otherDescription: 'Acta' });

            const res = await getById(id);
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(id);
            expect(res.body.data.history).toBe(false);
            expect(res.body.data.other).toBe(true);
            expect(res.body.data.otherDescription).toBe('Acta');
            expect(res.body.data.interviewHealthWorker).toBeNull();
            expect(res.body.data.investigation.status).not.toBeNull();
        });

        it('answers 404 for an id that does not exist', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVSRC_003_NOT_FOUND');
        });

        it('hides a source under a retired investigation from USER and ADMIN, not from SUPERADMIN', async () => {
            const id = await seedSource();
            await Investigation.update({ isActive: false }, { where: { investigationId: id } });

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'ADMIN')).status).toBe(404);

            const superadmin = await getById(id, 'SUPERADMIN');
            expect(superadmin.status).toBe(200);
            expect(superadmin.body.data.investigation.isActive).toBe(false);
        });

        it('still returns a sealed source while its investigation is active', async () => {
            // The seal does not hide the row — its parent does. That is what makes it possible
            // to consult a source before purging it
            const id = await seedSource();
            await seal(id);

            const res = await getById(id);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });

        it('does not capture the literal paths as an :id', async () => {
            expect((await request(app).get('/api/investigation-sources/admin').set(authHeader('ADMIN'))).status).toBe(200);
            expect((await getById('no-es-uuid')).status).toBe(400);
        });
    });

    describe('006 — get by case', () => {

        it('walks the two hops and returns the object, not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, autopsyRecord: true });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(false);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.autopsyRecord).toBe(true);
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('tells the three broken links apart with three distinct codes', async () => {
            const unknownCase = await getByCase(unknownUuid);
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('INVSRC_006_CASE_NOT_FOUND');

            const withoutInvestigation = await getByCase(await createCaseFixture());
            expect(withoutInvestigation.status).toBe(404);
            expect(withoutInvestigation.body.code).toBe('INVSRC_006_INVESTIGATION_NOT_FOUND');

            const caseWithoutSource = await createCaseFixture();
            await createInvestigationForCase(caseWithoutSource);
            const withoutSource = await getByCase(caseWithoutSource);
            expect(withoutSource.status).toBe(404);
            expect(withoutSource.body.code).toBe('INVSRC_006_NOT_FOUND');

            // The whole point: a client entering through a caseId must be able to tell which link
            // broke, because each one is a different action on its side
            const codes = [unknownCase.body.code, withoutInvestigation.body.code, withoutSource.body.code];
            expect(new Set(codes).size).toBe(3);
        });

        it('answers CASE_NOT_FOUND for an inactive case', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });
            await EsaviCase.update({ isActive: false }, { where: { caseId } });

            const res = await getByCase(caseId);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVSRC_006_CASE_NOT_FOUND');
        });

        it('validates the param', async () => {
            expect((await getByCase('no-es-uuid')).status).toBe(400);
        });
    });

    describe('004 — differential update', () => {

        it('writes nothing when the GET response is sent back whole', async () => {
            const id = await seedSource({ history: false, interviewHealthWorker: true, notes: 'algo' });
            await expectPutOfGetResponseWritesNothing({
                path: '/api/investigation-sources',
                id,
                model: InvestigationSource,
                role: 'USER',
                strip: ['investigation']
            });
        });

        it('writes nothing on an empty body either', async () => {
            const id = await seedSource({ history: true });
            const before = (await readRow(id))!;

            const res = await update(id, {});
            expect(res.status).toBe(200);

            const after = (await readRow(id))!;
            expect(versionOf(after)).toBe(versionOf(before));
            expect(after.getDataValue('updatedAt')).toEqual(before.getDataValue('updatedAt'));
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        it('adds exactly one entry and bumps the version by 1 when a single field changes', async () => {
            const id = await seedSource({ notes: 'inicial' });
            const before = (await readRow(id))!;

            const res = await update(id, { notes: 'corregido' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('corregido');
            expect(res.body.data.appDetails).toHaveLength(2);
            expect(res.body.data.appDetails[1].method).toBe('ESAVI-INVSRC-004');

            expect(versionOf((await readRow(id))!)).toBe((versionOf(before) ?? 0) + 1);
        });

        it('stores false over true, and null clears the field', async () => {
            // The criterion that matters most in this entity: an `if( data.x )` in the service
            // would silently discard this write and answer 200 all the same
            const id = await seedSource({ history: true });

            const toFalse = await update(id, { history: false });
            expect(toFalse.status).toBe(200);
            expect(toFalse.body.data.history).toBe(false);
            expect((await readRow(id))!.getDataValue('history')).toBe(false);

            const toNull = await update(id, { history: null });
            expect(toNull.body.data.history).toBeNull();
            expect((await readRow(id))!.getDataValue('history')).toBeNull();
        });

        it('does not count resending the eight sources with their false and null as a change', async () => {
            const id = await seedSource({ history: false, interviewVaccinatedPerson: true, autopsyRecord: false });
            const before = (await readRow(id))!;

            const res = await update(id, {
                history: false,
                interviewVaccinatedPerson: true,
                interviewHealthWorker: null,
                vaccinationRecord: null,
                autopsyRecord: false,
                verbalAutopsyRecord: null,
                investigationReport: null,
                other: null
            });
            expect(res.status).toBe(200);

            expect(versionOf((await readRow(id))!)).toBe(versionOf(before));
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        it('trims notes before comparing, and an empty string clears it', async () => {
            const id = await seedSource({ notes: 'texto' });
            const before = (await readRow(id))!;

            const padded = await update(id, { notes: '   texto   ' });
            expect(padded.status).toBe(200);
            expect(versionOf((await readRow(id))!)).toBe(versionOf(before));

            const emptied = await update(id, { notes: '' });
            expect(emptied.body.data.notes).toBeNull();
        });

        it('ignores investigationId in the body without erroring', async () => {
            const id = await seedSource();
            const otherInvestigationId = await createInvestigationFixture();

            const res = await update(id, { investigationId: otherInvestigationId });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(id);
            expect(await readRow(otherInvestigationId)).toBeNull();
        });

        it('answers 404 for an unknown id and for a retired investigation, 200 for SUPERADMIN', async () => {
            expect((await update(unknownUuid, { notes: 'x' })).status).toBe(404);

            const id = await seedSource();
            await Investigation.update({ isActive: false }, { where: { investigationId: id } });

            expect((await update(id, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await update(id, { notes: 'y' }, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('004 — the other source rule over the resulting state', () => {

        it('accepts switching the source on over a row that already carries a description', async () => {
            const id = await seedSource({ other: true, otherDescription: 'Acta externa' });

            const res = await update(id, { other: true });
            expect(res.status).toBe(200);
            expect(res.body.data.otherDescription).toBe('Acta externa');
        });

        it('requires a description when the resulting other is true and none is stored', async () => {
            const id = await seedSource();
            const res = await update(id, { other: true });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVSRC_004_OTHER_DESCRIPTION_REQUIRED');
        });

        it('clears the description in the same request when the source is switched off', async () => {
            const id = await seedSource({ other: true, otherDescription: 'Acta externa' });
            const entriesBefore = (await appDetailsOf(id)).length;

            const res = await update(id, { other: false });
            expect(res.status).toBe(200);
            expect(res.body.data.other).toBe(false);
            expect(res.body.data.otherDescription).toBeNull();

            // One single entry: the forcing is a derivative inside the same diff, not a second write
            expect(await appDetailsOf(id)).toHaveLength(entriesBefore + 1);
        });

        it('refuses a body that switches the source off and describes it at the same time', async () => {
            const id = await seedSource({ other: true, otherDescription: 'Acta externa' });

            const res = await update(id, { other: false, otherDescription: 'Otra acta' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVSRC_004_OTHER_DESCRIPTION_NOT_ALLOWED');

            // Nothing was written
            expect((await readRow(id))!.getDataValue('otherDescription')).toBe('Acta externa');
        });

        it('accepts an explicit null or empty description alongside a non-true other', async () => {
            const id = await seedSource({ other: true, otherDescription: 'Acta externa' });
            const withNull = await update(id, { other: false, otherDescription: null });
            expect(withNull.status).toBe(200);
            expect(withNull.body.data.otherDescription).toBeNull();

            const other = await seedSource({ other: true, otherDescription: 'Otra' });
            const withEmpty = await update(other, { other: false, otherDescription: '' });
            expect(withEmpty.status).toBe(200);
            expect(withEmpty.body.data.otherDescription).toBeNull();
        });

        it('writes nothing when switching off a source that was already off', async () => {
            // The forced null enters candidates, but the diff finds no difference
            const id = await seedSource({ other: false });
            const before = (await readRow(id))!;

            const res = await update(id, { other: false });
            expect(res.status).toBe(200);

            expect(versionOf((await readRow(id))!)).toBe(versionOf(before));
            expect(await appDetailsOf(id)).toHaveLength(1);
        });
    });

    describe('005C — purge', () => {

        it('answers 409 and keeps the row when deletedAt is not sealed', async () => {
            // The check that proves the isActive guard inside purgeEntityService is inert here:
            // the column does not exist, so without assertRowIsSealed every row would be purgable
            const id = await seedSource();

            const res = await purge(id);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVSRC_005C_NOT_DELETED');
            expect(res.body.message).toContain(id);
            expect(await readRow(id)).not.toBeNull();
        });

        it('destroys a sealed row, answers without data, and 404 on repeat', async () => {
            const id = await seedSource();
            await Investigation.update({ isActive: false }, { where: { investigationId: id } });
            await seal(id);

            const res = await purge(id);
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(id)).toBeNull();

            const again = await purge(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('INVSRC_005C_NOT_FOUND');

            // The investigation is left untouched
            expect(await Investigation.findByPk(id)).not.toBeNull();
        });

        it('is the only path that releases the investigationId', async () => {
            const id = await seedSource({ history: true });

            await seal(id);
            expect((await create({ investigationId: id })).status).toBe(409);

            expect((await purge(id)).status).toBe(200);

            const reborn = await create({ investigationId: id, history: false });
            expect(reborn.status).toBe(201);
            expect(reborn.body.data.history).toBe(false);
        });

        it('refuses the operation to ADMIN and answers 404 for an unknown id', async () => {
            const id = await seedSource();
            await seal(id);

            expect((await purge(id, 'ADMIN')).status).toBe(403);
            expect(await readRow(id)).not.toBeNull();

            expect((await purge(unknownUuid)).status).toBe(404);
        });

        it('does not expose 005A or 005B', async () => {
            const id = await seedSource();

            expect((await request(app).delete(`/api/investigation-sources/${ id }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).patch(`/api/investigation-sources/activate/${ id }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(404);
        });
    });

    describe('the three cascades of deletedAt', () => {

        it('INVESTGN-005A seals the source and INVESTGN-005B returns it', async () => {
            const id = await seedSource({ history: true });

            expect((await request(app).delete(`/api/investigations/${ id }`)
                .set(authHeader('ADMIN'))).status).toBe(200);
            expect((await readRow(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await appDetailsOf(id)).map(e => e.method))
                .toEqual(['ESAVI-INVSRC-001', 'ESAVI-INVESTGN-005A']);

            expect((await request(app).patch(`/api/investigations/activate/${ id }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);
            const cleared = (await readRow(id))!;
            expect(cleared.getDataValue('deletedAt')).toBeNull();
            expect((await appDetailsOf(id)).map(e => e.method))
                .toEqual(['ESAVI-INVSRC-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B']);
            // The data survives the round trip untouched
            expect(cleared.getDataValue('history')).toBe(true);
        });

        it('CASE-005A seals the source of the investigation of the case', async () => {
            // Deactivating the case drags the investigation with a mass update that does NOT go
            // through setInvestigationActivationService, so this is a cascade of its own. The
            // method recorded proves which one fired
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            expect((await request(app).delete(`/api/esavi-cases/${ caseId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);

            expect((await readRow(investigationId))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await appDetailsOf(investigationId)).map(e => e.method))
                .toEqual(['ESAVI-INVSRC-001', 'ESAVI-CASE-005A']);
        });

        it('CASE-005B does not clear the seal, coherent with F07', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            await request(app).delete(`/api/esavi-cases/${ caseId }`).set(authHeader('ADMIN'));
            const sealedAt = (await readRow(investigationId))!.getDataValue('deletedAt');

            expect((await request(app).patch(`/api/esavi-cases/activate/${ caseId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);

            expect((await readRow(investigationId))!.getDataValue('deletedAt')).toEqual(sealedAt);
            expect((await appDetailsOf(investigationId)).map(e => e.method))
                .toEqual(['ESAVI-INVSRC-001', 'ESAVI-CASE-005A']);
        });

        it('leaves a source sealed by hand with its original date and no new entry', async () => {
            const id = await seedSource();
            const handSealedAt = new Date('2020-01-02T03:04:05.000Z');
            await seal(id, handSealedAt);

            await request(app).delete(`/api/investigations/${ id }`).set(authHeader('ADMIN'));

            expect((await readRow(id))!.getDataValue('deletedAt')).toEqual(handSealedAt);
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        it('crosses the cascades without error when there is nothing to drag', async () => {
            const bareInvestigationId = await createInvestigationFixture();
            expect((await request(app).delete(`/api/investigations/${ bareInvestigationId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);
            expect((await request(app).patch(`/api/investigations/activate/${ bareInvestigationId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);

            const bareCaseId = await createCaseFixture();
            expect((await request(app).delete(`/api/esavi-cases/${ bareCaseId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);
        });

        it('INVESTGN-005C drags the source by Postgres cascade, dumps a warn line and does not error', async () => {
            const id = await seedSource({ notes: `a punto de desaparecer ${ suffix }` });
            await request(app).delete(`/api/investigations/${ id }`).set(authHeader('ADMIN'));

            const res = await request(app).delete(`/api/investigations/purge/${ id }`)
                .set(authHeader('SUPERADMIN'));
            expect(res.status).toBe(200);

            expect(await readRow(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            const log = fs.readFileSync('src/logs/esaviLog.log', 'utf8');
            expect(log).toContain('ESAVI-INVESTGN-005C: Investigation source dragged by ON DELETE CASCADE');
            expect(log).toContain(`a punto de desaparecer ${ suffix }`);
        });
    });
});
