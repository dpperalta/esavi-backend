import request from 'supertest';
import { CatalogItem, CatalogType, DiagnosticTerm, EsaviCase, HealthFacility, Investigation, InvestigationMedicalHistory, InvestigationPregnancyCondition, Patient } from '../../src/models';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';
import * as logs from '../../src/helpers/esaviLogs.helper';

/**
 * Contract suite for the eight investigationPregnancyCondition operations of SPEC F33. It walks
 * the entity end to end and covers what cannot be checked by hand reliably.
 *
 * Four things separate this entity from its sisters and get deliberate coverage:
 *
 *  - It is the FIRST GRANDDAUGHTER of the investigation block. The column is called
 *    investigationId and it does NOT point at investigation: it points at the primary key of
 *    investigationMedicalHistory, which happens to be the same UUID. The case that tells the
 *    two apart is a live investigation with NO medical history row, and it gets its own test.
 *  - The inherited visibility is a chain of two hops with the STATE ONLY IN THE SECOND one:
 *    the middle link has no isActive column, so it is checked by deletedAt. No chain before
 *    this one crossed a table with no state of its own.
 *  - It carries the sortOrder finding of F16 for the seventh time. The 005B is not a clean
 *    delegation: reactivating a row whose number another live sister already took would
 *    violate the partial unique index, so the collision scenario is walked whole.
 *  - Two derived fields and not three: this table has a single text column, so conditionRaw
 *    only keeps what the investigator wrote when it differs from the master's name, and the
 *    name the client displays is conditionRaw ?? diagnosticTerm.name.
 *
 * The duplicate guard gets deliberate coverage on both sides: it compares diagnosticTermId
 * alone — there is no type catalog here — and only against ACTIVE rows, so two free text
 * conditions never collide and a retired one never blocks reloading its term.
 */
describe('investigationPregnancyCondition contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const path = '/api/investigation-pregnancy-conditions';
    const historyPath = '/api/investigation-medical-histories';
    const investigationPath = '/api/investigations';

    let statusZeroItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // An investigation with no medical history: the fixture that tells the granddaughter apart
    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Condition ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`PC${ counter }${ suffix }`),
            healthSystemCode: `PC${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `PC${ counter }${ suffix }`,
            name: `Condition ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `PC-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        return (await Investigation.create({
            caseId: esaviCase.getDataValue('caseId'),
            statusItemId: statusZeroItemId,
            isActive
        })).getDataValue('investigationId');
    };

    // The medical history is built straight through the model: the service of F32 is not what is
    // under test here, and going through it would drag its own rules into every fixture
    const createHistoryFixture = async (
        isActive: boolean = true,
        attributes: Record<string, unknown> = {}
    ): Promise<string> => {
        const investigationId = await createInvestigationFixture(isActive);
        await InvestigationMedicalHistory.create({ investigationId, ...attributes });
        return investigationId;
    };

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post(path).set(authHeader(role)).send(payload);

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ path }/${ id }`).set(authHeader(role));

    const list = (investigationId: string, query: string = '', role: TestRole = 'USER') =>
        request(app).get(`${ path }/investigation/${ investigationId }${ query }`).set(authHeader(role));

    const listAdmin = (investigationId: string, query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`${ path }/admin/investigation/${ investigationId }${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ path }/${ id }`).set(authHeader(role)).send(payload);

    const remove = (id: string, role: TestRole = 'ADMIN') =>
        request(app).delete(`${ path }/${ id }`).set(authHeader(role));

    const activate = (id: string, role: TestRole = 'ADMIN') =>
        request(app).patch(`${ path }/activate/${ id }`).set(authHeader(role));

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ path }/purge/${ id }`).set(authHeader(role));

    // A condition over a fresh medical history, and the investigationId it hangs from
    const seed = async (payload: Record<string, unknown> = {}): Promise<[string, string]> => {
        const investigationId = await createHistoryFixture();
        const res = await create({ investigationId, conditionName: 'Anemia', ...payload });
        expect(res.status).toBe(201);
        return [res.body.data.pregnancyConditionId, investigationId];
    };

    const readRow = async (id: string) => await InvestigationPregnancyCondition.findByPk(id, { paranoid: false });

    const sortOrderOf = async (id: string) => (await readRow(id))!.getDataValue('sortOrder');

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    // updatedAt, the sysDetails version and the length of appDetails: the three marks a write
    // leaves and the differential update must not move
    const stateOf = async (id: string) => {
        const row = await readRow(id);
        return {
            updatedAt: row!.getDataValue('updatedAt'),
            version: (row!.getDataValue('sysDetails') as { version?: number } | null)?.version,
            appDetailsLength: ((row!.getDataValue('appDetails') as unknown[]) ?? []).length
        };
    };

    const sealHistory = (investigationId: string) =>
        InvestigationMedicalHistory.update({ deletedAt: new Date() }, { where: { investigationId } });

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

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

        it('opens the row with the minimum: { investigationId, conditionName } answers 201', async () => {
            const investigationId = await createHistoryFixture();
            const res = await create({ investigationId, conditionName: '  Diabetes gestacional  ' });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            const data = res.body.data;

            expect(data.investigationId).toBe(investigationId);
            expect(data.diagnosticTermId).toBeNull();
            expect(data.diagnosticTerm).toBeNull();
            expect(data.conditionRaw).toBe('Diabetes gestacional');
            expect(data.notes).toBeNull();
            expect(data.sortOrder).toBe(1);
            expect(data.isActive).toBe(true);
            expect(data.deletedAt).toBeNull();
            expect(data.appDetails[0].method).toBe('ESAVI-INVPREG-001');

            const second = await create({ investigationId, conditionName: 'Anemia' });
            expect(second.body.data.sortOrder).toBe(2);
        });

        it('the emitted INSERT does not carry the sortOrder column', async () => {
            const investigationId = await createHistoryFixture();
            const statements: string[] = [];
            const original = (sequelize.options as { logging?: unknown }).logging;
            (sequelize.options as { logging?: unknown }).logging = (sql: string) => { statements.push(sql); };

            await create({ investigationId, conditionName: 'Hipertension' });

            (sequelize.options as { logging?: unknown }).logging = original;

            const insert = statements.find(s => s.includes('INSERT INTO "investigationPregnancyCondition"'));
            expect(insert).toBeDefined();
            // Only the column list matters: sortOrder does come back in the RETURNING, which is how
            // the create instance learns the number the trigger assigned
            const columnList = insert!.slice(insert!.indexOf('('), insert!.indexOf('VALUES'));
            expect(columnList).not.toContain('sortOrder');
            expect(columnList).toContain('conditionRaw');
        });

        it('a fresh code with no source coins the term, and conditionRaw only keeps a divergence', async () => {
            const investigationId = await createHistoryFixture();
            const code = `F33A${ suffix }`;
            const res = await create({ investigationId, conditionName: 'Preeclampsia', conditionCode: code });

            expect(res.status).toBe(201);
            expect(res.body.data.diagnosticTermId).not.toBeNull();
            expect(res.body.data.conditionRaw).toBeNull();
            expect(res.body.data.diagnosticTerm.source).toBe('LOCAL');
            expect(res.body.data.diagnosticTerm.name).toBe('Preeclampsia');

            // The same code with a different text keeps what the investigator wrote
            const other = await createHistoryFixture();
            const diverging = await create({ investigationId: other, conditionName: 'Pre-eclampsia leve', conditionCode: code });
            expect(diverging.body.data.conditionRaw).toBe('Pre-eclampsia leve');
            expect(diverging.body.data.diagnosticTerm.name).toBe('Preeclampsia');
            expect(diverging.body.data.diagnosticTermId).toBe(res.body.data.diagnosticTermId);
        });

        it('an external source with an unknown code answers 404 and coins nothing', async () => {
            const investigationId = await createHistoryFixture();
            const before = await DiagnosticTerm.count();

            const res = await create({
                investigationId, conditionName: 'Cefalea',
                conditionCode: `F33MISS${ suffix }`, source: 'MEDDRA'
            });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVPREG_001_DIAGTERM_NOT_FOUND');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

        it('the three reasons of the parent guard answer the same 404, SUPERADMIN included', async () => {
            // The case that tells the granddaughter apart: a LIVE investigation with no medical
            // history row. A belongsTo pointing at investigation would let this one through
            const orphan = await createInvestigationFixture();

            const sealed = await createHistoryFixture();
            await sealHistory(sealed);

            const retired = await createHistoryFixture();
            await retireInvestigation(retired);

            for( const investigationId of [unknownUuid, orphan, sealed, retired] ) {
                for( const role of ['USER', 'SUPERADMIN'] as TestRole[] ) {
                    const res = await create({ investigationId, conditionName: 'Anemia' }, role);
                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVPREG_001_MEDICAL_HISTORY_NOT_FOUND');
                }
            }
        });

        it('the duplicate guard compares the term alone and only against active rows', async () => {
            const investigationId = await createHistoryFixture();
            const code = `F33DUP${ suffix }`;

            const first = await create({ investigationId, conditionName: 'Asma', conditionCode: code });
            expect(first.status).toBe(201);

            const duplicate = await create({ investigationId, conditionName: 'Asma', conditionCode: code });
            expect(duplicate.status).toBe(409);
            expect(duplicate.body.code).toBe('INVPREG_001_ALREADY_EXISTS');

            // Another medical history is not a duplicate
            const other = await createHistoryFixture();
            expect((await create({ investigationId: other, conditionName: 'Asma', conditionCode: code })).status).toBe(201);

            // A retired one does not block reloading its term
            expect((await remove(first.body.data.pregnancyConditionId)).status).toBe(200);
            expect((await create({ investigationId, conditionName: 'Asma', conditionCode: code })).status).toBe(201);
        });

        it('two free text conditions with the same text are two rows, not a 409', async () => {
            const investigationId = await createHistoryFixture();

            expect((await create({ investigationId, conditionName: 'Nausea' })).status).toBe(201);
            expect((await create({ investigationId, conditionName: 'Nausea' })).status).toBe(201);

            expect(await InvestigationPregnancyCondition.count({
                where: { investigationId, conditionRaw: 'Nausea' }
            })).toBe(2);
        });

        it('there is no coherence guard against isPregnancyConfirmed', async () => {
            for( const value of ['NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] ) {
                const investigationId = await createHistoryFixture(true, { isPregnancyConfirmed: value });
                expect((await create({ investigationId, conditionName: 'Anemia' })).status).toBe(201);
            }
            const nullBlock = await createHistoryFixture();
            expect((await create({ investigationId: nullBlock, conditionName: 'Anemia' })).status).toBe(201);
        });

        it('rejects a body that does not hold up', async () => {
            const investigationId = await createHistoryFixture();

            expect((await create({ investigationId })).status).toBe(400);
            expect((await create({ investigationId, conditionName: '   ' })).status).toBe(400);
            expect((await create({ investigationId, conditionName: 'a'.repeat(501) })).status).toBe(400);
            expect((await create({ investigationId, conditionName: 'x', source: 'NOPE' })).status).toBe(400);
            expect((await create({ investigationId: 'not-a-uuid', conditionName: 'x' })).status).toBe(400);
        });
    });

    describe('002A and 002B — the two listings by investigation', () => {

        // One active, one retired and one sealed
        const seedThree = async (): Promise<string> => {
            const investigationId = await createHistoryFixture();
            for( const name of ['Uno', 'Dos', 'Tres'] ) {
                expect((await create({ investigationId, conditionName: name })).status).toBe(201);
            }
            const rows = await InvestigationPregnancyCondition.findAll({
                where: { investigationId }, order: [['sortOrder', 'ASC']]
            });
            await InvestigationPregnancyCondition.update(
                { isActive: false },
                { where: { pregnancyConditionId: rows[1].getDataValue('pregnancyConditionId') } }
            );
            await InvestigationPregnancyCondition.update(
                { isActive: false, deletedAt: new Date() },
                { where: { pregnancyConditionId: rows[2].getDataValue('pregnancyConditionId') } }
            );
            return investigationId;
        };

        it('002A returns only the active ones, 002B also the inactive and the sealed', async () => {
            const investigationId = await seedThree();

            const active = await list(investigationId);
            expect(active.status).toBe(200);
            expect(active.body.data.count).toBe(1);
            expect(active.body.data.rows.map((r: { conditionRaw: string }) => r.conditionRaw)).toEqual(['Uno']);

            const all = await listAdmin(investigationId);
            expect(all.status).toBe(200);
            expect(all.body.data.count).toBe(3);
            expect(all.body.data.rows.map((r: { conditionRaw: string }) => r.conditionRaw)).toEqual(['Uno', 'Dos', 'Tres']);
            expect(all.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
            expect(all.body.data.rows[2].deletedAt).not.toBeNull();
        });

        it('a visible medical history with no conditions answers 200 with an empty page', async () => {
            const investigationId = await createHistoryFixture();

            for( const res of [await list(investigationId), await listAdmin(investigationId)] ) {
                expect(res.status).toBe(200);
                expect(res.body.data).toEqual({ count: 0, rows: [] });
            }
        });

        it('a medical history that does not exist answers 404 with any role', async () => {
            const orphan = await createInvestigationFixture();

            for( const investigationId of [unknownUuid, orphan] ) {
                for( const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[] ) {
                    const res = await list(investigationId, '', role);
                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVPREG_002A_MEDICAL_HISTORY_NOT_FOUND');
                }
                for( const role of ['ADMIN', 'SUPERADMIN'] as TestRole[] ) {
                    const res = await listAdmin(investigationId, '', role);
                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVPREG_002B_MEDICAL_HISTORY_NOT_FOUND');
                }
            }
        });

        it('an inactive investigation answers 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const investigationId = await createHistoryFixture();
            await create({ investigationId, conditionName: 'Anemia' });
            await retireInvestigation(investigationId);

            expect((await list(investigationId, '', 'USER')).status).toBe(404);
            expect((await list(investigationId, '', 'ADMIN')).status).toBe(404);
            const superadmin = await list(investigationId, '', 'SUPERADMIN');
            expect(superadmin.status).toBe(200);
            expect(superadmin.body.data.count).toBe(1);

            expect((await listAdmin(investigationId, '', 'ADMIN')).status).toBe(404);
            expect((await listAdmin(investigationId, '', 'SUPERADMIN')).status).toBe(200);
        });

        it('a sealed medical history answers 404 for everyone: existence is not relaxed', async () => {
            const investigationId = await createHistoryFixture();
            await create({ investigationId, conditionName: 'Anemia' });
            await sealHistory(investigationId);

            for( const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[] ) {
                expect((await list(investigationId, '', role)).status).toBe(404);
            }
            expect((await listAdmin(investigationId, '', 'SUPERADMIN')).status).toBe(404);
        });

        it('paginates with the total count and ignores every other query parameter', async () => {
            const investigationId = await createHistoryFixture();
            for( const name of ['Primera', 'Segunda', 'Tercera'] ) {
                await create({ investigationId, conditionName: name });
            }

            const page = await list(investigationId, '?limit=1&offset=1');
            expect(page.body.data.count).toBe(3);
            expect(page.body.data.rows).toHaveLength(1);
            expect(page.body.data.rows[0].conditionRaw).toBe('Segunda');

            const plain = (await list(investigationId)).body.data;
            const noisy = (await list(investigationId, '?diagnosticTermId=x&search=Primera&isActive=false')).body.data;
            expect(noisy).toEqual(plain);
        });

        it('002B with role USER answers 403', async () => {
            const investigationId = await createHistoryFixture();
            expect((await listAdmin(investigationId, '', 'USER')).status).toBe(403);
        });
    });

    describe('003 — get by id', () => {

        it('returns the exact shape of §3.7, with no sysDetails and no parent chain', async () => {
            const [id, investigationId] = await seed({ notes: '  segundo trimestre  ' });
            const res = await getById(id);

            expect(res.status).toBe(200);
            expect(Object.keys(res.body.data).sort()).toEqual([
                'appDetails', 'conditionRaw', 'createdAt', 'deletedAt', 'diagnosticTerm',
                'diagnosticTermId', 'investigationId', 'isActive', 'notes',
                'pregnancyConditionId', 'sortOrder', 'updatedAt'
            ]);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.notes).toBe('segundo trimestre');
            expect(res.body.data.diagnosticTerm).toBeNull();
            expect(res.body.data).not.toHaveProperty('sysDetails');
            expect(res.body.data).not.toHaveProperty('medicalHistory');
        });

        it('nests diagnosticTerm with six fields and without metadata', async () => {
            const [id] = await seed({ conditionName: 'Preeclampsia', conditionCode: `F33G${ suffix }` });
            const term = (await getById(id)).body.data.diagnosticTerm;

            expect(Object.keys(term).sort())
                .toEqual(['code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup']);
            expect(term).not.toHaveProperty('metadata');
        });

        it('the three reasons of invisibility answer 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const [inactiveId] = await seed();
            await remove(inactiveId);

            const [sealedId, sealedInvestigation] = await seed();
            await sealHistory(sealedInvestigation);

            const [retiredId, retiredInvestigation] = await seed();
            await retireInvestigation(retiredInvestigation);

            for( const id of [inactiveId, sealedId, retiredId] ) {
                for( const role of ['USER', 'ADMIN'] as TestRole[] ) {
                    const res = await getById(id, role);
                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVPREG_003_NOT_FOUND');
                }
                expect((await getById(id, 'SUPERADMIN')).status).toBe(200);
            }
        });

        it('the three combined behave the same way: none has priority', async () => {
            const [id, investigationId] = await seed();
            await remove(id);
            await sealHistory(investigationId);
            await retireInvestigation(investigationId);

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'SUPERADMIN')).status).toBe(200);
        });

        it('an unknown id answers 404 and a malformed one 400', async () => {
            expect((await getById(unknownUuid)).status).toBe(404);
            expect((await request(app).get(`${ path }/not-a-uuid`).set(authHeader('USER'))).status).toBe(400);
        });
    });

    describe('004 — the differential update', () => {

        it('a PUT with the body identical to what is stored writes nothing', async () => {
            const [id] = await seed({ notes: 'primer trimestre' });
            const before = await stateOf(id);

            expect((await update(id, { conditionName: 'Anemia', notes: 'primer trimestre' })).status).toBe(200);
            expect(await stateOf(id)).toEqual(before);
        });

        it('resending the whole GET response writes nothing, divergent conditionRaw included', async () => {
            const [plain] = await seed();
            await expectPutOfGetResponseWritesNothing({
                path, id: plain, model: InvestigationPregnancyCondition, role: 'USER'
            });

            // The trap the formula of incomingName covers: a row whose conditionRaw differs from the
            // master's name. Without the second condition this PUT would rewrite it silently
            const code = `F33DIV${ suffix }`;
            await create({ investigationId: await createHistoryFixture(), conditionName: 'Preeclampsia', conditionCode: code });
            const [id] = await seed({ conditionName: 'Pre-eclampsia leve', conditionCode: code });
            expect((await getById(id)).body.data.conditionRaw).toBe('Pre-eclampsia leve');

            await expectPutOfGetResponseWritesNothing({
                path, id, model: InvestigationPregnancyCondition, role: 'USER'
            });

            // And the same sending back by hand the effective name the GET displayed
            const before = await stateOf(id);
            const res = await update(id, { conditionName: 'Pre-eclampsia leve' });
            expect(res.status).toBe(200);
            expect(res.body.data.conditionRaw).toBe('Pre-eclampsia leve');
            expect(await stateOf(id)).toEqual(before);
        });

        it('a PUT changing one field writes that field and grows appDetails by exactly one', async () => {
            const [id] = await seed({ notes: 'inicial' });
            const before = await stateOf(id);

            const res = await update(id, { notes: '  corregido  ' });

            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('corregido');
            expect(res.body.data.conditionRaw).toBe('Anemia');

            const after = await stateOf(id);
            expect(after.appDetailsLength).toBe(before.appDetailsLength + 1);
            expect(after.updatedAt).not.toEqual(before.updatedAt);
            expect((await appDetailsOf(id)).map(e => e.method))
                .toEqual(['ESAVI-INVPREG-001', 'ESAVI-INVPREG-004']);
        });

        it('the resolution is fired by the change of value, not by the presence of the key', async () => {
            const code = `F33RES${ suffix }`;
            const [id] = await seed({ conditionName: 'Colestasis', conditionCode: code });

            const termsBefore = await DiagnosticTerm.count();
            const before = await stateOf(id);

            expect((await update(id, { conditionName: 'Colestasis', conditionCode: code })).status).toBe(200);
            expect(await DiagnosticTerm.count()).toBe(termsBefore);
            expect(await stateOf(id)).toEqual(before);

            const changed = await update(id, { conditionName: 'Colestasis', conditionCode: `${ code }X` });
            expect(changed.status).toBe(200);
            expect(await DiagnosticTerm.count()).toBe(termsBefore + 1);
            expect((await stateOf(id)).updatedAt).not.toEqual(before.updatedAt);
        });

        it('clearing the code drops the term and keeps the text as free text', async () => {
            const [id] = await seed({ conditionName: 'Anemia ferropenica', conditionCode: `F33CLR${ suffix }` });

            const res = await update(id, { conditionCode: null });

            expect(res.status).toBe(200);
            expect(res.body.data.diagnosticTermId).toBeNull();
            expect(res.body.data.diagnosticTerm).toBeNull();
            expect(res.body.data.conditionRaw).toBe('Anemia ferropenica');
        });

        it('the immutable fields are ignored in silence', async () => {
            const [id, investigationId] = await seed();
            const other = await createHistoryFixture();
            const before = await stateOf(id);

            const res = await update(id, { investigationId: other, sortOrder: 99 });

            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.sortOrder).toBe(1);
            expect(await stateOf(id)).toEqual(before);
        });

        it('notes is nullable and conditionName is not', async () => {
            const [id] = await seed({ notes: 'algo' });

            expect((await update(id, { notes: null })).body.data.notes).toBeNull();

            const before = await stateOf(id);
            expect((await update(id, {})).status).toBe(200);
            expect(await stateOf(id)).toEqual(before);

            expect((await update(id, { conditionName: null })).status).toBe(400);
            expect(await stateOf(id)).toEqual(before);
        });

        it('an empty diff answers 200 with the row as it is', async () => {
            const [id] = await seed();
            const res = await update(id, {});

            expect(res.status).toBe(200);
            expect(res.body.data.pregnancyConditionId).toBe(id);
        });

        it('resolving onto a term another live sister holds answers 409, the row itself excluded', async () => {
            const investigationId = await createHistoryFixture();
            const codeA = `F33DA${ suffix }`;
            const codeB = `F33DB${ suffix }`;
            await create({ investigationId, conditionName: 'Asma', conditionCode: codeA });
            const second = await create({ investigationId, conditionName: 'Rinitis', conditionCode: codeB });
            const id = second.body.data.pregnancyConditionId;

            const collision = await update(id, { conditionName: 'Asma', conditionCode: codeA });
            expect(collision.status).toBe(409);
            expect(collision.body.code).toBe('INVPREG_004_ALREADY_EXISTS');

            expect((await update(id, { conditionName: 'Rinitis', conditionCode: codeB })).status).toBe(200);
        });

        it('an external source with an unknown code answers 404 and the row is untouched', async () => {
            const [id] = await seed();
            const before = await stateOf(id);

            const res = await update(id, {
                conditionName: 'Cefalea', conditionCode: `F33U${ suffix }`, source: 'MEDDRA'
            });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVPREG_004_DIAGTERM_NOT_FOUND');
            expect(await stateOf(id)).toEqual(before);
        });

        it('applies the inherited visibility', async () => {
            const [sealedId, sealedInvestigation] = await seed();
            await sealHistory(sealedInvestigation);

            const [retiredId, retiredInvestigation] = await seed();
            await retireInvestigation(retiredInvestigation);

            for( const id of [sealedId, retiredId] ) {
                for( const role of ['USER', 'ADMIN'] as TestRole[] ) {
                    const res = await update(id, { notes: 'x' }, role);
                    expect(res.status).toBe(404);
                    expect(res.body.code).toBe('INVPREG_004_NOT_FOUND');
                }
                expect((await update(id, { notes: 'visible' }, 'SUPERADMIN')).status).toBe(200);
            }

            expect((await update(unknownUuid, { notes: 'x' })).status).toBe(404);
        });
    });

    describe('005A and 005B — activation', () => {

        it('the 005A seals the row without looking at its two parents', async () => {
            const [id] = await seed();

            const res = await remove(id);
            expect(res.status).toBe(200);
            expect(res.body).not.toHaveProperty('data');

            const row = await readRow(id);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();
            expect((await appDetailsOf(id)).map(e => e.method))
                .toEqual(['ESAVI-INVPREG-001', 'ESAVI-INVPREG-005A']);

            const repeated = await remove(id);
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('INVPREG_005A_ALREADY_INACTIVE');

            // Neither the sealed medical history nor the inactive investigation block it
            const [sealedId, sealedInvestigation] = await seed();
            await sealHistory(sealedInvestigation);
            expect((await remove(sealedId)).status).toBe(200);

            const [retiredId, retiredInvestigation] = await seed();
            await retireInvestigation(retiredInvestigation);
            expect((await remove(retiredId)).status).toBe(200);
        });

        it('the sortOrder collision scenario, whole', async () => {
            const investigationId = await createHistoryFixture();
            const one = (await create({ investigationId, conditionName: 'Uno' })).body.data;
            const two = (await create({ investigationId, conditionName: 'Dos' })).body.data;
            expect([one.sortOrder, two.sortOrder]).toEqual([1, 2]);

            // The 005A frees the number, so the next create legitimately reuses it
            expect((await remove(two.pregnancyConditionId)).status).toBe(200);
            const three = (await create({ investigationId, conditionName: 'Tres' })).body.data;
            expect(three.sortOrder).toBe(2);

            // Reactivating without reassignment would violate the partial unique index
            expect((await activate(two.pregnancyConditionId)).status).toBe(200);
            expect(await sortOrderOf(two.pregnancyConditionId)).toBe(3);

            const numbers = await Promise.all(
                [one, two, three].map(r => sortOrderOf(r.pregnancyConditionId))
            );
            expect(numbers.sort()).toEqual([1, 2, 3]);

            expect((await appDetailsOf(two.pregnancyConditionId)).map(e => e.method))
                .toEqual(['ESAVI-INVPREG-001', 'ESAVI-INVPREG-005A', 'ESAVI-INVPREG-005B']);
        });

        it('without collision the 005B keeps the original sortOrder', async () => {
            const investigationId = await createHistoryFixture();
            await create({ investigationId, conditionName: 'Uno' });
            const two = (await create({ investigationId, conditionName: 'Dos' })).body.data;

            await remove(two.pregnancyConditionId);
            expect((await activate(two.pregnancyConditionId)).status).toBe(200);
            expect(await sortOrderOf(two.pregnancyConditionId)).toBe(2);
        });

        it('reactivating an already active row answers 409', async () => {
            const [id] = await seed();

            const res = await activate(id);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVPREG_005B_ALREADY_ACTIVE');
            expect(await sortOrderOf(id)).toBe(1);
        });

        it('the 005B does not revalidate the duplicate guard: two live rows with one term', async () => {
            const investigationId = await createHistoryFixture();
            const code = `F33ACT${ suffix }`;
            const first = (await create({ investigationId, conditionName: 'Asma', conditionCode: code })).body.data;

            await remove(first.pregnancyConditionId);
            const second = (await create({ investigationId, conditionName: 'Asma', conditionCode: code })).body.data;
            expect(second.diagnosticTermId).toBe(first.diagnosticTermId);

            expect((await activate(first.pregnancyConditionId)).status).toBe(200);
            expect(await InvestigationPregnancyCondition.count({
                where: { investigationId, diagnosticTermId: first.diagnosticTermId, isActive: true }
            })).toBe(2);
        });

        it('the 005B does not revalidate the state of the parents either', async () => {
            const [sealedId, sealedInvestigation] = await seed();
            await remove(sealedId);
            await sealHistory(sealedInvestigation);
            expect((await activate(sealedId)).status).toBe(200);

            const [retiredId, retiredInvestigation] = await seed();
            await remove(retiredId);
            await retireInvestigation(retiredInvestigation);
            expect((await activate(retiredId)).status).toBe(200);
        });

        it('the minimum roles are ADMIN on both, and an unknown id answers 404', async () => {
            const [id] = await seed();

            expect((await remove(id, 'USER')).status).toBe(403);
            expect((await remove(id, 'ADMIN')).status).toBe(200);
            expect((await activate(id, 'USER')).status).toBe(403);
            expect((await activate(id, 'ADMIN')).status).toBe(200);

            expect((await remove(unknownUuid)).body.code).toBe('INVPREG_005A_NOT_FOUND');
            expect((await activate(unknownUuid)).body.code).toBe('INVPREG_005B_NOT_FOUND');
        });
    });

    describe('005C — purge', () => {

        it('an active condition answers 409 and a retired one is destroyed', async () => {
            const [active] = await seed();
            const stillActive = await purge(active);
            expect(stillActive.status).toBe(409);
            expect(stillActive.body.code).toBe('INVPREG_005C_STILL_ACTIVE');
            expect(await readRow(active)).not.toBeNull();

            await remove(active);
            expect((await purge(active)).status).toBe(200);
            expect(await readRow(active)).toBeNull();
            expect((await getById(active, 'SUPERADMIN')).status).toBe(404);
            expect((await purge(active)).body.code).toBe('INVPREG_005C_NOT_FOUND');
        });

        it('the diagnosticTerm it cited survives', async () => {
            const [id] = await seed({ conditionName: 'Preeclampsia', conditionCode: `F33PUR${ suffix }` });
            const { diagnosticTermId } = (await getById(id)).body.data;

            await remove(id);
            expect((await purge(id)).status).toBe(200);

            expect(await DiagnosticTerm.findByPk(diagnosticTermId)).not.toBeNull();
        });

        it('the minimum role is SUPERADMIN', async () => {
            const [id] = await seed();
            await remove(id);

            expect((await purge(id, 'USER')).status).toBe(403);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
            expect((await purge(id, 'SUPERADMIN')).status).toBe(200);
        });
    });

    describe('the two dumps in foreign services', () => {

        let logSpy: jest.SpyInstance;

        beforeEach(() => {
            logSpy = jest.spyOn(logs, 'esaviLog');
        });

        afterEach(() => {
            logSpy.mockRestore();
        });

        const conditionLines = (operationCode: string): string[] =>
            logSpy.mock.calls
                .filter(call => String(call[0]).startsWith(`${ operationCode }:`)
                    && String(call[0]).includes('investigation pregnancy condition(s)')
                    && call[1] === 'warn')
                .map(call => String(call[0]));

        it('ESAVI-INVMEDH-005C writes one line with the count and does not block', async () => {
            const investigationId = await createHistoryFixture();
            const ids: string[] = [];
            for( const name of ['Uno', 'Dos', 'Tres'] ) {
                ids.push((await create({ investigationId, conditionName: name })).body.data.pregnancyConditionId);
            }
            // A sealed one is counted too: the cascade destroys it all the same
            await remove(ids[2]);

            await sealHistory(investigationId);
            const res = await request(app)
                .delete(`${ historyPath }/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(res.status).toBe(200);
            const lines = conditionLines('ESAVI-INVMEDH-005C');
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('3 investigation pregnancy condition(s) dragged by ON DELETE CASCADE');
            expect(await InvestigationPregnancyCondition.count({ where: { investigationId }, paranoid: false })).toBe(0);
        });

        it('ESAVI-INVMEDH-005C with no conditions writes no line', async () => {
            const investigationId = await createHistoryFixture();
            await sealHistory(investigationId);

            expect((await request(app)
                .delete(`${ historyPath }/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);

            expect(conditionLines('ESAVI-INVMEDH-005C')).toHaveLength(0);
        });

        it('ESAVI-INVESTGN-005C writes its own line, in two hops and after the medical history one', async () => {
            const investigationId = await createHistoryFixture();
            for( const name of ['Uno', 'Dos'] ) {
                await create({ investigationId, conditionName: name });
            }
            await Investigation.update(
                { isActive: false, deletedAt: new Date() },
                { where: { investigationId } }
            );

            const res = await request(app)
                .delete(`${ investigationPath }/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'));
            expect(res.status).toBe(200);

            const cascade = logSpy.mock.calls
                .filter(call => String(call[0]).startsWith('ESAVI-INVESTGN-005C:')
                    && String(call[0]).includes('dragged by ON DELETE CASCADE'))
                .map(call => String(call[0]));

            const conditionLine = cascade.findIndex(l => l.includes('pregnancy condition(s)'));
            const historyLine = cascade.findIndex(l => l.includes('medical history'));
            expect(conditionLine).toBeGreaterThan(historyLine);
            expect(cascade[conditionLine])
                .toContain('2 investigation pregnancy condition(s) dragged by ON DELETE CASCADE in two hops');

            expect(await InvestigationPregnancyCondition.count({ where: { investigationId }, paranoid: false })).toBe(0);
        });

        it('ESAVI-INVESTGN-005C over an investigation with no medical history writes neither line', async () => {
            const investigationId = await createInvestigationFixture();
            await Investigation.update(
                { isActive: false, deletedAt: new Date() },
                { where: { investigationId } }
            );

            expect((await request(app)
                .delete(`${ investigationPath }/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);

            expect(conditionLines('ESAVI-INVESTGN-005C')).toHaveLength(0);
        });
    });
});
