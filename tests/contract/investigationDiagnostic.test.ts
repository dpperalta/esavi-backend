import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, DiagnosticTerm, EsaviCase, HealthFacility, Investigation, InvestigationDiagnostic, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine investigationDiagnostic operations of SPEC F58. It walks the entity
 * end to end and covers what cannot be checked by hand reliably: the inherited visibility of a
 * single hop chain, the sortOrder the database assigns and the collision the reactivation has to
 * resolve, the three branches of the resolution against the clinical master, and the log dump of a
 * foreign service.
 *
 * Four things separate this entity from its sisters and get deliberate coverage:
 *
 *  - It is the SECOND TABLE this repository adds to the DDL after F57, and the FIRST one that also
 *    seeds its own catalog: the three diagnosticType items are created by esaviapp.sql, not loaded
 *    as a deployment precondition. The suite reads them from the database instead of creating them.
 *  - It hangs from investigation and NOT from investigationClinicalEvaluation, deliberately, so the
 *    inherited visibility is ONE HOP over the parent's own isActive — the shape of F31 and F37 and
 *    not the two hop chain with paranoid: false that F33 needed. A create over an investigation with
 *    no clinical evaluation at all answers 201, and that case gets its own test.
 *  - Its duplicate guard is over the RESOLVED TERM ALONE and not over the pair (term, type), it is
 *    backed by no database constraint, and it compares against ACTIVE rows only. The three
 *    consequences — free text never collides, a different type does not save a duplicate, and a 005B
 *    can leave two live rows sharing a term — are asserted one by one.
 *  - It carries two columns no sister of clinical resolution has, diagnosticDate and
 *    diagnosticTypeItemId, both nullable and neither captured by the current form. They enter the
 *    differential update compared against undefined and never by truthiness.
 *
 * The 005B ordering gets coverage of its own: the sortOrder reassignment runs BEFORE the activation
 * helper, because while deletedAt is still sealed the row sits outside the partial unique index.
 */
describe('investigationDiagnostic contract', () => {
    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-diagnostics';
    const investigationPath = '/api/investigations';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');
    let statusZeroItemId: string;
    let confirmedItemId: string;
    let presumptiveItemId: string;
    let inactiveTypeItemId: string;
    let foreignItemId: string;
    let counter = 0;
    let consoleError: jest.SpyInstance;

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        statusZeroItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '0' }
        }))!.getDataValue('catalogItemId');
        // An item of another catalogType, to prove the guard checks the type and not only the id
        foreignItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '1' }
        }))!.getDataValue('catalogItemId');

        // Seeded by esaviapp.sql, not created here: this is the first entity whose catalog the DDL
        // mints, and reading them back is what proves the seed landed
        const diagType = await CatalogType.findOne({ where: { code: 'diagnosticType' } });
        confirmedItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: diagType!.getDataValue('catalogTypeId'), code: 'CONFIRMED' }
        }))!.getDataValue('catalogItemId');
        presumptiveItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: diagType!.getDataValue('catalogTypeId'), code: 'PRESUMPTIVE' }
        }))!.getDataValue('catalogItemId');
        inactiveTypeItemId = (await CatalogItem.create({
            catalogTypeId: diagType!.getDataValue('catalogTypeId'),
            code: `RETIRED_${ suffix }`,
            name: `Retired ${ suffix }`,
            value: `RETIRED_${ suffix }`,
            isActive: false
        })).getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // --- fixtures -----------------------------------------------------------------------------

    const createCase = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Diag ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`DG${ counter }${ suffix }`),
            healthSystemCode: `DG${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `DG${ counter }${ suffix }`,
            name: `Facility ${ counter } ${ suffix }`
        });
        return (await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `DG-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        })).getDataValue('caseId');
    };

    const createInvestigationFor = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const createInvestigation = async (isActive: boolean = true): Promise<string> =>
        createInvestigationFor(await createCase(), isActive);

    // --- request helpers ----------------------------------------------------------------------

    const post = (body: object, role: TestRole = 'USER') =>
        request(app).post(basePath).set(authHeader(role)).send(body);
    const get = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));
    const put = (id: string, body: object, role: TestRole = 'USER') =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(body);
    const del = (id: string, role: TestRole = 'ADMIN') =>
        request(app).delete(`${ basePath }/${ id }`).set(authHeader(role));
    const activate = (id: string, role: TestRole = 'ADMIN') =>
        request(app).patch(`${ basePath }/activate/${ id }`).set(authHeader(role));
    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));
    const listPublic = (investigationId: string, role: TestRole = 'USER', query: string = '') =>
        request(app).get(`${ basePath }/investigation/${ investigationId }${ query }`).set(authHeader(role));
    const listAdmin = (investigationId: string, role: TestRole = 'ADMIN', query: string = '') =>
        request(app).get(`${ basePath }/admin/investigation/${ investigationId }${ query }`).set(authHeader(role));
    const listByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/case/${ caseId }`).set(authHeader(role));

    const readRow = (id: string) => InvestigationDiagnostic.findByPk(id, { paranoid: false });
    const version = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number }).version;
    const detailCount = async (id: string) =>
        ((await readRow(id))!.getDataValue('appDetails') as unknown[]).length;

    const logOffset = () => (fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0);
    const logSince = (offset: number) => fs.readFileSync(logPath, 'utf8').slice(offset);

    const missingUuid = '11111111-1111-4111-8111-111111111111';

    // --- the DDL and the seed -------------------------------------------------------------------

    describe('DDL and seed', () => {
        it('seeds exactly three diagnosticType items with code equal to value', async () => {
            const diagType = await CatalogType.findOne({ where: { code: 'diagnosticType' } });
            const items = await CatalogItem.findAll({
                where: { catalogTypeId: diagType!.getDataValue('catalogTypeId') },
                order: [['sortOrder', 'ASC']]
            });
            const seeded = items.filter(i => !String(i.getDataValue('code')).startsWith('RETIRED_'));

            expect(seeded.map(i => i.getDataValue('code'))).toEqual(['PRESUMPTIVE', 'CONFIRMED', 'DIFFERENTIAL']);
            expect(seeded.map(i => i.getDataValue('value'))).toEqual(['PRESUMPTIVE', 'CONFIRMED', 'DIFFERENTIAL']);
            expect(seeded.map(i => i.getDataValue('sortOrder'))).toEqual([1, 2, 3]);
        });

        it('lets a physical DELETE through, so the 005C is possible at all', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Fisico' })).body.data.diagnosticId;

            await InvestigationDiagnostic.destroy({ where: { diagnosticId: id }, force: true });
            expect(await readRow(id)).toBeNull();
        });

        it('drags the diagnoses with the ON DELETE CASCADE of the parent', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'En cascada' })).body.data.diagnosticId;

            await Investigation.destroy({ where: { investigationId }, force: true });
            expect(await readRow(id)).toBeNull();
        });
    });

    // --- 001 ------------------------------------------------------------------------------------

    describe('001 — create', () => {
        it('creates the minimum row, trims the text and lets the trigger assign sortOrder', async () => {
            const investigationId = await createInvestigation();

            const first = await post({ investigationId, diagnosticName: '  Guillain Barre  ' });
            expect(first.status).toBe(201);

            const data = first.body.data;
            expect(data.diagnosticTermId).toBeNull();
            expect(data.diagnosticTerm).toBeNull();
            expect(data.diagnosticRaw).toBe('Guillain Barre');
            expect(data.diagnosticDate).toBeNull();
            expect(data.diagnosticTypeItemId).toBeNull();
            expect(data.diagnosticType).toBeNull();
            expect(data.notes).toBeNull();
            expect(data.isActive).toBe(true);
            expect(data.sortOrder).toBe(1);
            expect(data.sysDetails).toBeUndefined();
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVDIAG-001');

            const second = await post({ investigationId, diagnosticName: 'Fiebre' });
            expect(second.body.data.sortOrder).toBe(2);
        });

        it('emits an INSERT that does not carry the sortOrder column', async () => {
            const investigationId = await createInvestigation();
            const sequelize = InvestigationDiagnostic.sequelize!;
            const inserts: string[] = [];

            const original = sequelize.query.bind(sequelize);
            const spy = jest.spyOn(sequelize, 'query').mockImplementation((sql: unknown, options?: unknown) => {
                const text = typeof sql === 'string' ? sql : String((sql as { query?: string })?.query ?? '');
                if( text.includes('INSERT INTO "investigationDiagnostic"') ) inserts.push(text);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return original(sql as any, options as any);
            });

            const res = await post({ investigationId, diagnosticName: 'Sin sortOrder' });
            spy.mockRestore();

            expect(res.status).toBe(201);
            expect(inserts).toHaveLength(1);
            // The column is absent from the statement, which is what lets the trigger assign it.
            // Omitting the value would not be enough: the model declares it allowNull: false with no
            // defaultValue, so Sequelize would reject the row before ever reaching Postgres
            // Only the column list matters: sortOrder does come back in the RETURNING clause,
            // which is precisely how the response learns the number the trigger assigned
            const columnList = inserts[0].slice(0, inserts[0].indexOf(' VALUES '));
            expect(columnList).not.toContain('"sortOrder"');
            expect(columnList).toContain('"diagnosticRaw"');
            expect(inserts[0]).toContain('RETURNING');
            expect(res.body.data.sortOrder).toBe(1);
        });

        it('resolves a LOCAL code, creating the term, and nulls diagnosticRaw when the name matches', async () => {
            const investigationId = await createInvestigation();
            const code = `LOCDG${ suffix }`;

            const created = await post({ investigationId, diagnosticName: 'Encefalitis', diagnosticCode: code });
            expect(created.status).toBe(201);
            expect(created.body.data.diagnosticTermId).not.toBeNull();
            expect(created.body.data.diagnosticRaw).toBeNull();
            expect(created.body.data.diagnosticTerm.source).toBe('LOCAL');
            expect(created.body.data.diagnosticTerm.code).toBe(code.toUpperCase());
            expect(created.body.data.diagnosticTerm.metadata).toBeUndefined();

            const other = await createInvestigation();
            const diverging = await post({ investigationId: other, diagnosticName: 'Encefalitis aguda', diagnosticCode: code });
            expect(diverging.body.data.diagnosticRaw).toBe('Encefalitis aguda');
            expect(diverging.body.data.diagnosticTermId).toBe(created.body.data.diagnosticTermId);
        });

        it('never creates a term for an external source and 404s when the pair does not exist', async () => {
            const investigationId = await createInvestigation();
            const before = await DiagnosticTerm.count();

            const res = await post({
                investigationId,
                diagnosticName: 'Nada',
                diagnosticCode: `NOPE${ suffix }`,
                source: 'MEDDRA'
            });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVDIAG_001_DIAGTERM_NOT_FOUND');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

        it('guards diagnosticTypeItemId with its three conditions and applies no default', async () => {
            const investigationId = await createInvestigation();

            for( const itemId of [missingUuid, inactiveTypeItemId, foreignItemId] ) {
                const res = await post({ investigationId, diagnosticName: 'X', diagnosticTypeItemId: itemId });
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVDIAG_001_INVALID_DIAGNOSTIC_TYPE');
            }

            const ok = await post({ investigationId, diagnosticName: 'Valido', diagnosticTypeItemId: confirmedItemId });
            expect(ok.status).toBe(201);
            expect(ok.body.data.diagnosticType.code).toBe('CONFIRMED');
            expect(Object.keys(ok.body.data.diagnosticType).sort())
                .toEqual(['catalogItemId', 'code', 'name', 'value']);

            // Absent means null, never a substituted item
            const none = await post({ investigationId, diagnosticName: 'Sin tipo' });
            expect(none.body.data.diagnosticTypeItemId).toBeNull();
        });

        it('rejects a future date, accepts today, and crosses it with no other date', async () => {
            const investigationId = await createInvestigation();
            const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
            const today = new Date().toISOString().slice(0, 10);

            expect((await post({ investigationId, diagnosticName: 'A', diagnosticDate: tomorrow })).status).toBe(400);
            expect((await post({ investigationId, diagnosticName: 'B', diagnosticDate: today })).body.data.diagnosticDate)
                .toBe(today);

            // investigationStartDate is not consulted: a diagnosis may be dated before it
            await Investigation.update(
                { investigationStartDate: '2025-06-01' },
                { where: { investigationId } }
            );
            expect((await post({ investigationId, diagnosticName: 'C', diagnosticDate: '2024-01-01' })).status).toBe(201);
        });

        it('404s a missing or inactive investigation, also for a SUPERADMIN', async () => {
            const inactive = await createInvestigation(false);

            for( const role of ['USER', 'SUPERADMIN'] as TestRole[] ) {
                const missing = await post({ investigationId: missingUuid, diagnosticName: 'A' }, role);
                expect(missing.status).toBe(404);
                expect(missing.body.code).toBe('INVDIAG_001_INVESTIGATION_NOT_FOUND');

                const retired = await post({ investigationId: inactive, diagnosticName: 'A' }, role);
                expect(retired.status).toBe(404);
                expect(retired.body.code).toBe('INVDIAG_001_INVESTIGATION_NOT_FOUND');
            }
        });

        it('does not require an investigationClinicalEvaluation, and ignores statusItemId', async () => {
            const investigationId = await createInvestigation();
            // No clinical evaluation was ever created for this investigation
            expect((await post({ investigationId, diagnosticName: 'Sin evaluacion' })).status).toBe(201);

            const deathItem = await CatalogItem.findOne({
                where: { catalogItemId: foreignItemId }
            });
            await Investigation.update(
                { statusItemId: deathItem!.getDataValue('catalogItemId') },
                { where: { investigationId } }
            );
            expect((await post({ investigationId, diagnosticName: 'Con otro estado' })).status).toBe(201);
        });

        it('409s a duplicate resolved term even with another type, and never a repeated free text', async () => {
            const investigationId = await createInvestigation();
            const code = `DUPDG${ suffix }`;

            expect((await post({ investigationId, diagnosticName: 'Dup', diagnosticCode: code })).status).toBe(201);

            const dup = await post({
                investigationId,
                diagnosticName: 'Dup',
                diagnosticCode: code,
                diagnosticTypeItemId: confirmedItemId
            });
            expect(dup.status).toBe(409);
            expect(dup.body.code).toBe('INVDIAG_001_ALREADY_EXISTS');

            expect((await post({ investigationId, diagnosticName: 'Texto libre' })).status).toBe(201);
            expect((await post({ investigationId, diagnosticName: 'Texto libre' })).status).toBe(201);
        });

        it('accepts the term again once the row holding it was retired', async () => {
            const investigationId = await createInvestigation();
            const code = `RETRY${ suffix }`;
            const first = (await post({ investigationId, diagnosticName: 'Uno', diagnosticCode: code })).body.data.diagnosticId;

            expect((await post({ investigationId, diagnosticName: 'Uno', diagnosticCode: code })).status).toBe(409);
            await del(first);
            expect((await post({ investigationId, diagnosticName: 'Uno', diagnosticCode: code })).status).toBe(201);
        });

        it('rejects the malformed body at the validator', async () => {
            const investigationId = await createInvestigation();

            expect((await post({ investigationId })).status).toBe(400);
            expect((await post({ investigationId, diagnosticName: 'x'.repeat(501) })).status).toBe(400);
            expect((await post({ investigationId, diagnosticName: 'A', source: 'NOPE' })).status).toBe(400);
            expect((await post({ investigationId, diagnosticName: 'A', diagnosticTypeItemId: 'not-a-uuid' })).status).toBe(400);
            expect((await post({ investigationId: 'not-a-uuid', diagnosticName: 'A' })).status).toBe(400);
        });
    });

    // --- 002A and 002B --------------------------------------------------------------------------

    describe('002A and 002B — the two listings by investigation', () => {
        it('splits live rows from all of them, both ordered by sortOrder', async () => {
            const investigationId = await createInvestigation();
            const first = (await post({ investigationId, diagnosticName: 'Uno' })).body.data.diagnosticId;
            await post({ investigationId, diagnosticName: 'Dos' });
            await post({ investigationId, diagnosticName: 'Tres' });
            await del(first);

            const publicList = await listPublic(investigationId);
            expect(publicList.status).toBe(200);
            expect(publicList.body.data.count).toBe(2);
            expect(publicList.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([2, 3]);
            expect(publicList.body.data.rows[0].sysDetails).toBeUndefined();

            const adminList = await listAdmin(investigationId);
            expect(adminList.body.data.count).toBe(3);
            expect(adminList.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
            expect(adminList.body.data.rows[0].deletedAt).not.toBeNull();
        });

        it('200s an empty page for a childless investigation and 404s a missing one', async () => {
            const investigationId = await createInvestigation();
            expect((await listPublic(investigationId)).body.data).toEqual({ count: 0, rows: [] });

            for( const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[] ) {
                const missing = await listPublic(missingUuid, role);
                expect(missing.status).toBe(404);
                expect(missing.body.code).toBe('INVDIAG_002A_INVESTIGATION_NOT_FOUND');
            }
        });

        it('404s an inactive investigation for USER and ADMIN and 200s it for SUPERADMIN', async () => {
            const investigationId = await createInvestigation();
            await post({ investigationId, diagnosticName: 'Uno' });
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await listPublic(investigationId, 'USER')).status).toBe(404);
            expect((await listPublic(investigationId, 'ADMIN')).status).toBe(404);
            expect((await listPublic(investigationId, 'SUPERADMIN')).status).toBe(200);
            expect((await listAdmin(investigationId, 'ADMIN')).status).toBe(404);
            expect((await listAdmin(investigationId, 'SUPERADMIN')).status).toBe(200);
        });

        it('403s the 002B for a USER', async () => {
            expect((await listAdmin(await createInvestigation(), 'USER')).status).toBe(403);
        });

        it('paginates with the total count and admits no filter', async () => {
            const investigationId = await createInvestigation();
            await post({ investigationId, diagnosticName: 'Uno' });
            await post({ investigationId, diagnosticName: 'Dos' });
            await post({ investigationId, diagnosticName: 'Tres' });

            const page = await listPublic(investigationId, 'USER', '?limit=1&offset=1');
            expect(page.body.data.count).toBe(3);
            expect(page.body.data.rows).toHaveLength(1);
            expect(page.body.data.rows[0].sortOrder).toBe(2);

            const filtered = await listPublic(investigationId, 'USER', `?diagnosticTypeItemId=${ missingUuid }`);
            expect(filtered.body.data.count).toBe(3);
        });
    });

    // --- 003 ------------------------------------------------------------------------------------

    describe('003 — read by id', () => {
        it('returns the exact shape of the contract', async () => {
            const investigationId = await createInvestigation();
            const created = await post({
                investigationId,
                diagnosticName: 'Meningitis',
                diagnosticCode: `RDCODE${ suffix }`,
                diagnosticDate: '2026-03-01',
                diagnosticTypeItemId: confirmedItemId,
                notes: '  con secuelas  '
            });

            const res = await get(created.body.data.diagnosticId);
            expect(res.status).toBe(200);
            const data = res.body.data;

            expect(Object.keys(data).sort()).toEqual([
                'appDetails', 'createdAt', 'deletedAt', 'diagnosticDate', 'diagnosticId',
                'diagnosticRaw', 'diagnosticTerm', 'diagnosticTermId', 'diagnosticType',
                'diagnosticTypeItemId', 'investigationId', 'isActive', 'notes', 'sortOrder', 'updatedAt'
            ]);
            expect(data.sysDetails).toBeUndefined();
            expect(data.investigation).toBeUndefined();
            expect(Object.keys(data.diagnosticTerm).sort())
                .toEqual(['code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup']);
            expect(Object.keys(data.diagnosticType).sort())
                .toEqual(['catalogItemId', 'code', 'name', 'value']);

            // DATEONLY: the plain calendar day, with no hour and no zone offset
            expect(data.diagnosticDate).toBe('2026-03-01');
            expect(data.notes).toBe('con secuelas');
        });

        it('nulls both catalog reads when the diagnosis carries neither', async () => {
            const investigationId = await createInvestigation();
            const created = await post({ investigationId, diagnosticName: 'Texto libre' });

            const res = await get(created.body.data.diagnosticId);
            expect(res.body.data.diagnosticTerm).toBeNull();
            expect(res.body.data.diagnosticType).toBeNull();
        });

        it('404s a missing id', async () => {
            const res = await get(missingUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVDIAG_003_NOT_FOUND');
        });

        it('applies the inherited visibility for each reason and for both combined', async () => {
            const inactiveRow = async () => {
                const investigationId = await createInvestigation();
                const id = (await post({ investigationId, diagnosticName: 'A' })).body.data.diagnosticId;
                await del(id);
                return id;
            };
            const inactiveParent = async () => {
                const investigationId = await createInvestigation();
                const id = (await post({ investigationId, diagnosticName: 'B' })).body.data.diagnosticId;
                await Investigation.update({ isActive: false }, { where: { investigationId } });
                return id;
            };
            const both = async () => {
                const investigationId = await createInvestigation();
                const id = (await post({ investigationId, diagnosticName: 'C' })).body.data.diagnosticId;
                await del(id);
                await Investigation.update({ isActive: false }, { where: { investigationId } });
                return id;
            };

            for( const make of [inactiveRow, inactiveParent, both] ) {
                const id = await make();
                expect((await get(id, 'USER')).status).toBe(404);
                expect((await get(id, 'ADMIN')).status).toBe(404);
                expect((await get(id, 'SUPERADMIN')).status).toBe(200);
            }
        });
    });

    // --- 006 ------------------------------------------------------------------------------------

    describe('006 — the listing by case', () => {
        it('walks case to investigation to diagnoses and returns { count, rows }', async () => {
            const caseId = await createCase();
            const investigationId = await createInvestigationFor(caseId);
            await post({ investigationId, diagnosticName: 'Uno' });
            await post({ investigationId, diagnosticName: 'Dos' });

            const res = await listByCase(caseId);
            expect(res.status).toBe(200);
            expect(res.body.data.count).toBe(2);
            expect(res.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2]);
            // Every row carries the investigationId, which is the entry to the 002B
            expect(res.body.data.rows[0].investigationId).toBe(investigationId);
        });

        it('tells the two broken links apart', async () => {
            const missing = await listByCase(missingUuid);
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVDIAG_006_CASE_NOT_FOUND');

            const inactiveCase = await createCase(false);
            await createInvestigationFor(inactiveCase);
            expect((await listByCase(inactiveCase)).body.code).toBe('INVDIAG_006_CASE_NOT_FOUND');

            const withoutInvestigation = await createCase();
            expect((await listByCase(withoutInvestigation)).body.code).toBe('INVDIAG_006_INVESTIGATION_NOT_FOUND');
        });

        it('200s an empty page when the chain is whole and nothing was recorded', async () => {
            const caseId = await createCase();
            await createInvestigationFor(caseId);
            expect((await listByCase(caseId)).body.data).toEqual({ count: 0, rows: [] });
        });

        it('never returns inactive diagnoses, not even for a SUPERADMIN', async () => {
            const caseId = await createCase();
            const investigationId = await createInvestigationFor(caseId);
            const first = (await post({ investigationId, diagnosticName: 'Uno' })).body.data.diagnosticId;
            await post({ investigationId, diagnosticName: 'Dos' });
            await del(first);

            for( const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[] ) {
                const res = await listByCase(caseId, role);
                expect(res.body.data.count).toBe(1);
                expect(res.body.data.rows[0].sortOrder).toBe(2);
            }
        });
    });

    // --- 004, the differential update -----------------------------------------------------------

    describe('004 — the differential update', () => {
        it('writes nothing when the body repeats what is stored', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({
                investigationId,
                diagnosticName: 'Sin cambios',
                diagnosticDate: '2025-01-02',
                diagnosticTypeItemId: confirmedItemId,
                notes: 'nota'
            })).body.data.diagnosticId;

            const updatedAtBefore = (await readRow(id))!.getDataValue('updatedAt');
            const versionBefore = await version(id);
            const detailsBefore = await detailCount(id);

            const res = await put(id, {
                diagnosticName: 'Sin cambios',
                diagnosticDate: '2025-01-02',
                diagnosticTypeItemId: confirmedItemId,
                notes: 'nota'
            });
            expect(res.status).toBe(200);

            expect((await readRow(id))!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
            expect(await version(id)).toBe(versionBefore);
            expect(await detailCount(id)).toBe(detailsBefore);
        });

        it('writes nothing when the whole GET response is sent back, raw divergence included', async () => {
            // Mint the master term first, so the second capture diverges from its canonical name
            const seedInvestigation = await createInvestigation();
            await post({
                investigationId: seedInvestigation,
                diagnosticName: 'Encefalitis',
                diagnosticCode: `PUTGET${ suffix }`
            });

            const investigationId = await createInvestigation();
            const id = (await post({
                investigationId,
                diagnosticName: 'Encefalitis aguda severa',
                diagnosticCode: `PUTGET${ suffix }`,
                diagnosticDate: '2025-02-03',
                diagnosticTypeItemId: presumptiveItemId,
                notes: 'observaciones'
            })).body.data.diagnosticId;

            expect((await get(id)).body.data.diagnosticRaw).not.toBeNull();

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id,
                model: InvestigationDiagnostic,
                role: 'USER'
            });
        });

        it('writes one field and adds exactly one audit entry', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Uno', notes: 'vieja' })).body.data.diagnosticId;
            const detailsBefore = await detailCount(id);

            const res = await put(id, { notes: 'nueva' });
            expect(res.body.data.notes).toBe('nueva');
            expect(res.body.data.diagnosticRaw).toBe('Uno');
            expect(await detailCount(id)).toBe(detailsBefore + 1);

            const details = (await readRow(id))!.getDataValue('appDetails') as { method: string }[];
            expect(details[details.length - 1].method).toBe('ESAVI-INVDIAG-004');
            expect(details[0].method).toBe('ESAVI-INVDIAG-001');
        });

        it('re-resolves on a changed code and leaves the master alone on an identical one', async () => {
            const investigationId = await createInvestigation();
            const code = `SAME${ suffix }`;
            const id = (await post({ investigationId, diagnosticName: 'Termino', diagnosticCode: code })).body.data.diagnosticId;

            const termsBefore = await DiagnosticTerm.count();
            const updatedAtBefore = (await readRow(id))!.getDataValue('updatedAt');

            expect((await put(id, { diagnosticName: 'Termino', diagnosticCode: code })).status).toBe(200);
            expect(await DiagnosticTerm.count()).toBe(termsBefore);
            expect((await readRow(id))!.getDataValue('updatedAt')).toEqual(updatedAtBefore);

            const changed = await put(id, { diagnosticName: 'Otro termino', diagnosticCode: `OTHER${ suffix }` });
            expect(await DiagnosticTerm.count()).toBe(termsBefore + 1);
            expect(changed.body.data.diagnosticTerm.code).toBe(`OTHER${ suffix }`);
        });

        it('skips the type guard on an identical value and rejects an invalid new one without writing', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({
                investigationId,
                diagnosticName: 'Tipo',
                diagnosticTypeItemId: confirmedItemId
            })).body.data.diagnosticId;

            const updatedAtBefore = (await readRow(id))!.getDataValue('updatedAt');
            expect((await put(id, { diagnosticTypeItemId: confirmedItemId })).status).toBe(200);
            expect((await readRow(id))!.getDataValue('updatedAt')).toEqual(updatedAtBefore);

            const invalid = await put(id, { diagnosticTypeItemId: foreignItemId });
            expect(invalid.status).toBe(400);
            expect(invalid.body.code).toBe('INVDIAG_004_INVALID_DIAGNOSTIC_TYPE');
            expect((await readRow(id))!.getDataValue('diagnosticTypeItemId')).toBe(confirmedItemId);
            expect((await readRow(id))!.getDataValue('updatedAt')).toEqual(updatedAtBefore);

            expect((await put(id, { diagnosticTypeItemId: presumptiveItemId })).body.data.diagnosticType.code)
                .toBe('PRESUMPTIVE');
        });

        it('ignores the immutable fields in silence', async () => {
            const investigationId = await createInvestigation();
            const other = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Inmutable' })).body.data.diagnosticId;

            expect((await put(id, { investigationId: other, sortOrder: 99 })).status).toBe(200);
            const row = (await readRow(id))!;
            expect(row.getDataValue('investigationId')).toBe(investigationId);
            expect(row.getDataValue('sortOrder')).toBe(1);
        });

        it('compares the three nullables against undefined and never by truthiness', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({
                investigationId,
                diagnosticName: 'Anulables',
                diagnosticDate: '2025-03-04',
                diagnosticTypeItemId: confirmedItemId,
                notes: 'algo'
            })).body.data.diagnosticId;

            const untouched = await put(id, {});
            expect(untouched.body.data.diagnosticDate).toBe('2025-03-04');
            expect(untouched.body.data.diagnosticTypeItemId).toBe(confirmedItemId);
            expect(untouched.body.data.notes).toBe('algo');

            const detailsBefore = await detailCount(id);
            const erased = await put(id, { diagnosticDate: null, diagnosticTypeItemId: null, notes: null });
            expect(erased.body.data.diagnosticDate).toBeNull();
            expect(erased.body.data.diagnosticTypeItemId).toBeNull();
            expect(erased.body.data.diagnosticType).toBeNull();
            expect(erased.body.data.notes).toBeNull();
            expect(await detailCount(id)).toBe(detailsBefore + 1);

            // diagnosticName is optional but NOT nullable: an explicit null never reaches the service
            expect((await put(id, { diagnosticName: null })).status).toBe(400);
        });

        it('answers 200 with the row when the diff comes back empty', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Vacio' })).body.data.diagnosticId;

            const res = await put(id, {});
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data.diagnosticId).toBe(id);
        });

        it('409s when it resolves onto a live sister and excludes the row itself', async () => {
            const investigationId = await createInvestigation();
            const codeA = `DUPA${ suffix }`;
            const codeB = `DUPB${ suffix }`;
            const first = (await post({ investigationId, diagnosticName: 'A', diagnosticCode: codeA })).body.data.diagnosticId;
            const second = (await post({ investigationId, diagnosticName: 'B', diagnosticCode: codeB })).body.data.diagnosticId;

            const clash = await put(second, { diagnosticName: 'A', diagnosticCode: codeA });
            expect(clash.status).toBe(409);
            expect(clash.body.code).toBe('INVDIAG_004_ALREADY_EXISTS');

            expect((await put(first, { diagnosticName: 'A', diagnosticCode: codeA })).status).toBe(200);
        });

        it('writes in no other table', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Padre' })).body.data.diagnosticId;

            const parentBefore = (await Investigation.findByPk(investigationId))!.getDataValue('updatedAt');
            await put(id, { diagnosticName: 'Padre cambiado', notes: 'x', diagnosticDate: '2025-06-07' });
            expect((await Investigation.findByPk(investigationId))!.getDataValue('updatedAt')).toEqual(parentBefore);
        });

        it('404s a missing id and applies the inherited visibility', async () => {
            expect((await put(missingUuid, { notes: 'x' })).status).toBe(404);

            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Oculto' })).body.data.diagnosticId;
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await put(id, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await put(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await put(id, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
        });
    });

    // --- 005A and 005B --------------------------------------------------------------------------

    describe('005A — deactivate', () => {
        it('seals the state, records the method and 409s the repetition', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Uno' })).body.data.diagnosticId;

            expect((await del(id)).status).toBe(200);
            const row = (await readRow(id))!;
            expect(row.getDataValue('isActive')).toBe(false);
            expect(row.getDataValue('deletedAt')).not.toBeNull();

            const details = row.getDataValue('appDetails') as { method: string }[];
            expect(details[details.length - 1].method).toBe('ESAVI-INVDIAG-005A');

            const again = await del(id);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('INVDIAG_005A_ALREADY_INACTIVE');
        });

        it('does not check the state of the investigation', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Huerfano' })).body.data.diagnosticId;
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await del(id)).status).toBe(200);
        });

        it('frees the sortOrder for the next create', async () => {
            const investigationId = await createInvestigation();
            const first = (await post({ investigationId, diagnosticName: 'Uno' })).body.data;
            await del(first.diagnosticId);

            expect((await post({ investigationId, diagnosticName: 'Dos' })).body.data.sortOrder).toBe(1);
        });

        it('touches no other table when the last live diagnosis goes', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Ultimo' })).body.data.diagnosticId;

            const parentBefore = (await Investigation.findByPk(investigationId))!.getDataValue('updatedAt');
            await del(id);
            expect((await Investigation.findByPk(investigationId))!.getDataValue('updatedAt')).toEqual(parentBefore);
        });

        it('is ADMIN and 404s a missing id', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Rol' })).body.data.diagnosticId;

            expect((await del(id, 'USER')).status).toBe(403);
            expect((await del(id, 'ADMIN')).status).toBe(200);
            expect((await del(missingUuid)).body.code).toBe('INVDIAG_005A_NOT_FOUND');
        });
    });

    describe('005B — reactivate', () => {
        it('resolves the sortOrder collision by sending the row to the end of the list', async () => {
            const investigationId = await createInvestigation();
            const one = (await post({ investigationId, diagnosticName: 'Uno' })).body.data;
            const two = (await post({ investigationId, diagnosticName: 'Dos' })).body.data;
            expect([one.sortOrder, two.sortOrder]).toEqual([1, 2]);

            // Retiring the 2 frees its number from the partial index
            await del(two.diagnosticId);
            // The new one takes MAX(1) + 1 = 2 and collides with the retired row
            expect((await post({ investigationId, diagnosticName: 'Tres' })).body.data.sortOrder).toBe(2);

            expect((await activate(two.diagnosticId)).status).toBe(200);
            expect((await readRow(two.diagnosticId))!.getDataValue('sortOrder')).toBe(3);

            const live = await InvestigationDiagnostic.findAll({
                where: { investigationId, deletedAt: null },
                order: [['sortOrder', 'ASC']]
            });
            expect(live.map(r => r.getDataValue('sortOrder'))).toEqual([1, 2, 3]);
        });

        it('keeps the original number when nothing collides, and 409s a live row', async () => {
            const investigationId = await createInvestigation();
            const one = (await post({ investigationId, diagnosticName: 'Uno' })).body.data;
            const two = (await post({ investigationId, diagnosticName: 'Dos' })).body.data;
            await del(two.diagnosticId);

            expect((await activate(two.diagnosticId)).status).toBe(200);
            expect((await readRow(two.diagnosticId))!.getDataValue('sortOrder')).toBe(2);
            expect((await readRow(two.diagnosticId))!.getDataValue('deletedAt')).toBeNull();
            expect((await readRow(one.diagnosticId))!.getDataValue('sortOrder')).toBe(1);

            const details = (await readRow(two.diagnosticId))!.getDataValue('appDetails') as { method: string }[];
            expect(details[details.length - 1].method).toBe('ESAVI-INVDIAG-005B');

            const again = await activate(two.diagnosticId);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('INVDIAG_005B_ALREADY_ACTIVE');
        });

        it('is ADMIN and not SUPERADMIN, and 404s a missing id', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Rol' })).body.data.diagnosticId;
            await del(id);

            expect((await activate(id, 'USER')).status).toBe(403);
            expect((await activate(id, 'ADMIN')).status).toBe(200);
            expect((await activate(missingUuid)).body.code).toBe('INVDIAG_005B_NOT_FOUND');
        });

        it('revalidates neither the duplicate guard, nor the type, nor the parent state', async () => {
            const investigationId = await createInvestigation();
            const code = `REACT${ suffix }`;

            const first = (await post({
                investigationId,
                diagnosticName: 'Termino',
                diagnosticCode: code,
                diagnosticTypeItemId: confirmedItemId
            })).body.data;
            await del(first.diagnosticId);
            expect((await post({ investigationId, diagnosticName: 'Termino', diagnosticCode: code })).status).toBe(201);

            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: confirmedItemId } });
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await activate(first.diagnosticId)).status).toBe(200);

            const live = await InvestigationDiagnostic.findAll({ where: { investigationId, isActive: true } });
            expect(live).toHaveLength(2);
            expect(new Set(live.map(r => r.getDataValue('diagnosticTermId'))).size).toBe(1);

            await CatalogItem.update({ isActive: true }, { where: { catalogItemId: confirmedItemId } });
        });
    });

    // --- 005C -----------------------------------------------------------------------------------

    describe('005C — purge', () => {
        it('409s a live row, destroys a retired one and leaves both masters alive', async () => {
            const investigationId = await createInvestigation();
            const created = (await post({
                investigationId,
                diagnosticName: 'A purgar',
                diagnosticCode: `PURGE${ suffix }`,
                diagnosticTypeItemId: confirmedItemId
            })).body.data;

            const active = await purge(created.diagnosticId);
            expect(active.status).toBe(409);
            expect(active.body.code).toBe('INVDIAG_005C_STILL_ACTIVE');
            expect(await readRow(created.diagnosticId)).not.toBeNull();

            await del(created.diagnosticId);
            expect((await purge(created.diagnosticId)).status).toBe(200);
            expect(await readRow(created.diagnosticId)).toBeNull();
            expect((await get(created.diagnosticId, 'SUPERADMIN')).status).toBe(404);

            expect(await DiagnosticTerm.findByPk(created.diagnosticTermId)).not.toBeNull();
            expect(await CatalogItem.findByPk(confirmedItemId)).not.toBeNull();
        });

        it('writes the warn snapshot before destroying the row', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: `Rastro ${ suffix }` })).body.data.diagnosticId;
            await del(id);

            const before = logOffset();
            expect((await purge(id)).status).toBe(200);

            const written = logSince(before);
            expect(written).toContain('ESAVI-INVDIAG-005C');
            expect(written).toContain(id);
        });

        it('is SUPERADMIN only, 404s a missing id and ignores the parent state', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Rol' })).body.data.diagnosticId;
            await del(id);
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await purge(id, 'USER')).status).toBe(403);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
            expect((await purge(id, 'SUPERADMIN')).status).toBe(200);
            expect((await purge(missingUuid)).body.code).toBe('INVDIAG_005C_NOT_FOUND');
        });
    });

    // --- the dump of ESAVI-INVESTGN-005C --------------------------------------------------------

    describe('the dump of the cascade of ESAVI-INVESTGN-005C', () => {
        const deactivateInvestigation = (id: string) =>
            Investigation.update({ isActive: false, deletedAt: new Date() }, { where: { investigationId: id } });
        const purgeInvestigation = (id: string) =>
            request(app).delete(`${ investigationPath }/purge/${ id }`).set(authHeader('SUPERADMIN'));

        it('writes one warn line with the count and every id, retired rows included', async () => {
            const investigationId = await createInvestigation();
            const ids = [
                (await post({ investigationId, diagnosticName: 'Uno' })).body.data.diagnosticId,
                (await post({ investigationId, diagnosticName: 'Dos' })).body.data.diagnosticId,
                (await post({ investigationId, diagnosticName: 'Tres' })).body.data.diagnosticId
            ];
            await del(ids[2]);
            await deactivateInvestigation(investigationId);

            const before = logOffset();
            expect((await purgeInvestigation(investigationId)).status).toBe(200);

            const dumpLines = logSince(before).split('\n')
                .filter(l => l.includes('investigation diagnostic(s) dragged'));
            expect(dumpLines).toHaveLength(1);
            expect(dumpLines[0]).toContain('3 investigation diagnostic(s) dragged');
            for( const id of ids ) {
                expect(dumpLines[0]).toContain(id);
            }

            expect(await InvestigationDiagnostic.count({ where: { investigationId }, paranoid: false })).toBe(0);
        });

        it('writes no line when the investigation has no diagnoses', async () => {
            const investigationId = await createInvestigation();
            await deactivateInvestigation(investigationId);

            const before = logOffset();
            expect((await purgeInvestigation(investigationId)).status).toBe(200);
            expect(logSince(before)).not.toContain('investigation diagnostic(s) dragged');
        });

        it('does not abort the purge when the dump itself fails', async () => {
            const investigationId = await createInvestigation();
            await post({ investigationId, diagnosticName: 'Uno' });
            await deactivateInvestigation(investigationId);

            const findAll = jest.spyOn(InvestigationDiagnostic, 'findAll').mockRejectedValueOnce(new Error('boom'));
            const before = logOffset();

            expect((await purgeInvestigation(investigationId)).status).toBe(200);
            expect(logSince(before)).toContain('Failed to dump the investigation diagnostics before the cascade');
            expect(await Investigation.findByPk(investigationId, { paranoid: false })).toBeNull();

            findAll.mockRestore();
        });

        it('is not reached by the 005A of the investigation', async () => {
            const investigationId = await createInvestigation();
            const id = (await post({ investigationId, diagnosticName: 'Vivo' })).body.data.diagnosticId;

            const res = await request(app)
                .delete(`${ investigationPath }/${ investigationId }`)
                .set(authHeader('ADMIN'));
            expect(res.status).toBe(200);

            const row = (await readRow(id))!;
            expect(row.getDataValue('isActive')).toBe(true);
            expect(row.getDataValue('deletedAt')).toBeNull();
        });
    });

    // --- routing --------------------------------------------------------------------------------

    describe('routing', () => {
        it('reaches each operation by its own path and never falls into /:id', async () => {
            expect((await listByCase(missingUuid)).body.code).toBe('INVDIAG_006_CASE_NOT_FOUND');
            expect((await listAdmin(missingUuid)).body.code).toBe('INVDIAG_002B_INVESTIGATION_NOT_FOUND');
            expect((await listPublic(missingUuid)).body.code).toBe('INVDIAG_002A_INVESTIGATION_NOT_FOUND');
            expect((await purge(missingUuid)).body.code).toBe('INVDIAG_005C_NOT_FOUND');
            expect((await activate(missingUuid)).body.code).toBe('INVDIAG_005B_NOT_FOUND');
            expect((await get(missingUuid)).body.code).toBe('INVDIAG_003_NOT_FOUND');
            expect((await put(missingUuid, { notes: 'x' })).body.code).toBe('INVDIAG_004_NOT_FOUND');
            expect((await del(missingUuid)).body.code).toBe('INVDIAG_005A_NOT_FOUND');
        });

        it('400s a :id that is not a UUID and has no global listing', async () => {
            expect((await get('not-a-uuid')).status).toBe(400);
            expect((await request(app).get(basePath).set(authHeader('SUPERADMIN'))).status).toBe(404);
        });
    });
});
