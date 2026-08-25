import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationVaccineAdministered, Patient, VaccineWhodrug } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine investigationVaccineAdministered operations of SPEC F37. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited visibility of
 * a single hop chain, the sortOrder the database assigns and the collision the reactivation has to
 * resolve, the uniqueness of a triple one of whose members may be null, and the log dumps of a
 * foreign service.
 *
 * Four things separate this entity from its sisters and get deliberate coverage:
 *
 *  - It is the SECOND COLLECTION hanging straight off investigation, after investigationTeamMember,
 *    and the FIRST satellite of investigation since F31 with a complete 005A and 005B — the table
 *    does have an isActive column, which F29, F30, F32, F34 and F36 do not.
 *  - Its uniqueness is over a TRIPLE, (investigationId, vaccineWhodrugId, doseNumber), and the third
 *    member is nullable. Two rows of the same vaccine with no dose number are the same row twice, so
 *    the null has to compare with IS NULL and not with = NULL. That case gets its own test in the
 *    001 and in the 005B: without it the duplicate walks in and nothing else notices.
 *  - vaccineWhodrugId is REQUIRED at the application level although the DDL declares it nullable, and
 *    the rule is split across two layers: the validator resolves the create, the service resolves the
 *    update over the resulting state. The pair "PUT with null is 400, PUT without the key is 200" is
 *    what proves absent and null are not the same thing.
 *  - Its sortOrder is nullable and carries no DEFAULT 0, like F35 and unlike the other seven tables
 *    of the setSortOrderByParent loop, so the create needs no CREATE_FIELDS and a row may
 *    legitimately hold no number at all — a case the 005B skips instead of resolving.
 *
 * The 005B ordering gets coverage of its own: the uniqueness guard runs BEFORE the sortOrder
 * reassignment, and the test that pins it down asserts the rejected row is left completely untouched.
 */
describe('investigationVaccineAdministered contract', () => {
    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-vaccines-administered';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');
    let statusZeroItemId: string;
    let counter = 0;
    let consoleError: jest.SpyInstance;

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        const item = await CatalogItem.findOne({ where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '0' } });
        statusZeroItemId = item!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // --- fixtures -----------------------------------------------------------------------------

    const createWhodrug = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        return (await VaccineWhodrug.create({
            drugCode: `VA${ counter }${ suffix }`,
            drugName: `Vaccine ${ counter } ${ suffix }`,
            isActive
        })).getDataValue('vaccineWhodrugId');
    };

    const createCase = async (): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Vac ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`VA${ counter }${ suffix }`),
            healthSystemCode: `VA${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `VA${ counter }${ suffix }`,
            name: `Facility ${ counter } ${ suffix }`
        });
        return (await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `VA-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        })).getDataValue('caseId');
    };

    const createInvestigation = async (isActive: boolean = true): Promise<string> => {
        const caseId = await createCase();
        return (await Investigation.create({
            caseId,
            statusItemId: statusZeroItemId,
            isActive
        })).getDataValue('investigationId');
    };

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

    const readRow = (id: string) => InvestigationVaccineAdministered.findByPk(id, { paranoid: false });
    const version = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number }).version;
    const detailCount = async (id: string) =>
        ((await readRow(id))!.getDataValue('appDetails') as unknown[]).length;

    const missingUuid = '11111111-1111-4111-8111-111111111111';

    // --- 001 ----------------------------------------------------------------------------------

    describe('001 — create', () => {
        it('creates the minimum row and returns the full shape', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();

            const created = await post({ investigationId, vaccineWhodrugId: whodrugId });
            expect(created.status).toBe(201);

            const data = created.body.data;
            expect(data.doseNumber).toBeNull();
            expect(data.notes).toBeNull();
            expect(data.isActive).toBe(true);
            expect(data.sortOrder).toBe(1);
            expect(data.investigationId).toBe(investigationId);

            // The raw foreign key travels beside the resolved object, which is what lets a PUT
            // resend the response of its GET
            expect(data.vaccineWhodrugId).toBe(whodrugId);
            expect(data.vaccineWhodrug).toEqual({
                vaccineWhodrugId: whodrugId,
                drugCode: expect.any(String),
                drugName: expect.any(String)
            });

            // The twelve columns of §3.7 and nothing else
            expect(Object.keys(data).sort()).toEqual([
                'appDetails', 'createdAt', 'deletedAt', 'doseNumber', 'investigationId', 'isActive',
                'notes', 'sortOrder', 'updatedAt', 'vaccineAdministeredId', 'vaccineWhodrug', 'vaccineWhodrugId'
            ]);
            expect(data.sysDetails).toBeUndefined();
            expect(data.investigation).toBeUndefined();

            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVVACAD-001');
        });

        it('lets the database assign 1, 2 and 3 without the application ever sending it', async () => {
            const investigationId = await createInvestigation();
            const orders: number[] = [];
            for( let i = 0; i < 3; i += 1 ) {
                const whodrugId = await createWhodrug();
                orders.push((await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.sortOrder);
            }
            expect(orders).toEqual([1, 2, 3]);
        });

        it('ignores a sortOrder sent in the body without answering 400', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const created = await post({ investigationId, vaccineWhodrugId: whodrugId, sortOrder: 99 });
            expect(created.status).toBe(201);
            expect(created.body.data.sortOrder).toBe(1);
        });

        it('answers 404 on an investigation that does not exist or is inactive', async () => {
            const whodrugId = await createWhodrug();

            const missing = await post({ investigationId: missingUuid, vaccineWhodrugId: whodrugId });
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVVACAD_001_INVESTIGATION_NOT_FOUND');

            const inactiveId = await createInvestigation(false);
            const inactive = await post({ investigationId: inactiveId, vaccineWhodrugId: whodrugId });
            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('INVVACAD_001_INVESTIGATION_NOT_FOUND');

            // Not even a SUPERADMIN can add to a retired investigation
            const asSuperadmin = await post({ investigationId: inactiveId, vaccineWhodrugId: whodrugId }, 'SUPERADMIN');
            expect(asSuperadmin.status).toBe(404);
        });

        it('answers 404 on a master entry that does not exist or is inactive', async () => {
            const investigationId = await createInvestigation();

            const missing = await post({ investigationId, vaccineWhodrugId: missingUuid });
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVVACAD_001_WHODRUG_NOT_FOUND');

            const inactiveWhodrugId = await createWhodrug(false);
            const inactive = await post({ investigationId, vaccineWhodrugId: inactiveWhodrugId });
            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('INVVACAD_001_WHODRUG_NOT_FOUND');
        });

        it('answers 400 without vaccineWhodrugId and with an explicit null', async () => {
            const investigationId = await createInvestigation();

            expect((await post({ investigationId })).status).toBe(400);
            expect((await post({ investigationId, vaccineWhodrugId: null })).status).toBe(400);
        });

        it('answers 400 on a doseNumber out of range by either end, and stores the 0', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();

            expect((await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: -1 })).status).toBe(400);
            // 32767 is the smallint ceiling: without the validator this would be a 500 from Postgres
            expect((await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 40000 })).status).toBe(400);

            const zero = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 0 });
            expect(zero.status).toBe(201);
            expect(zero.body.data.doseNumber).toBe(0);
        });

        it('trims the notes on write', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const created = await post({ investigationId, vaccineWhodrugId: whodrugId, notes: '  written by hand  ' });
            expect(created.body.data.notes).toBe('written by hand');
        });

        it('rejects the repeated triple and admits the same vaccine on a different dose', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();

            const first = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 2 });
            expect(first.status).toBe(201);

            const duplicate = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 2 });
            expect(duplicate.status).toBe(409);
            expect(duplicate.body.code).toBe('INVVACAD_001_ALREADY_EXISTS');
            expect(duplicate.body.message).toContain('2');

            // The dose is part of the identity
            expect((await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 3 })).status).toBe(201);
        });

        it('rejects the SECOND row of the same vaccine with no doseNumber at all', async () => {
            // The case that proves the null compares with IS NULL and not with = NULL. Without it
            // the duplicate walks in and no other case detects it
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();

            expect((await post({ investigationId, vaccineWhodrugId: whodrugId })).status).toBe(201);
            const second = await post({ investigationId, vaccineWhodrugId: whodrugId });
            expect(second.status).toBe(409);
            expect(second.body.code).toBe('INVVACAD_001_ALREADY_EXISTS');
        });

        it('compares only against the live rows: after a 005A the triple is free again', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const first = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 4 });

            await del(first.body.data.vaccineAdministeredId);

            const reborn = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 4 });
            expect(reborn.status).toBe(201);
            // The 005A freed the number too
            expect(reborn.body.data.sortOrder).toBe(1);
        });
    });

    // --- 002A / 002B --------------------------------------------------------------------------

    describe('002A and 002B — the dual listing by investigation', () => {
        it('hides the retired rows in the public listing and shows them in the admin one', async () => {
            const investigationId = await createInvestigation();
            const created = [];
            for( let i = 0; i < 3; i += 1 ) {
                const whodrugId = await createWhodrug();
                created.push((await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data);
            }
            await del(created[1].vaccineAdministeredId);

            const publicList = await listPublic(investigationId);
            expect(publicList.status).toBe(200);
            expect(publicList.body.data.count).toBe(2);
            expect(publicList.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 3]);

            const adminList = await listAdmin(investigationId);
            expect(adminList.status).toBe(200);
            expect(adminList.body.data.count).toBe(3);
            expect(adminList.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
        });

        it('gives every row the full shape, with the master resolved and no sysDetails', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 1, notes: 'listed' });

            for( const response of [await listPublic(investigationId), await listAdmin(investigationId)] ) {
                const row = response.body.data.rows[0];
                expect(Object.keys(row).sort()).toEqual([
                    'appDetails', 'createdAt', 'deletedAt', 'doseNumber', 'investigationId', 'isActive',
                    'notes', 'sortOrder', 'updatedAt', 'vaccineAdministeredId', 'vaccineWhodrug', 'vaccineWhodrugId'
                ]);
                expect(row.vaccineWhodrug).toEqual({
                    vaccineWhodrugId: whodrugId,
                    drugCode: expect.any(String),
                    drugName: expect.any(String)
                });
                expect(row.sysDetails).toBeUndefined();
                expect(row.investigation).toBeUndefined();
            }
        });

        it('paginates keeping the total count', async () => {
            const investigationId = await createInvestigation();
            for( let i = 0; i < 3; i += 1 ) {
                const whodrugId = await createWhodrug();
                await post({ investigationId, vaccineWhodrugId: whodrugId });
            }
            const paged = await listAdmin(investigationId, 'ADMIN', '?limit=2');
            expect(paged.body.data.count).toBe(3);
            expect(paged.body.data.rows).toHaveLength(2);
        });

        it('answers 200 with count 0 on an investigation with no vaccines', async () => {
            const investigationId = await createInvestigation();
            const empty = await listPublic(investigationId);
            expect(empty.status).toBe(200);
            expect(empty.body.data).toEqual({ count: 0, rows: [] });
        });

        it('answers 404 on an inactive investigation, and 200 for SUPERADMIN', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            await post({ investigationId, vaccineWhodrugId: whodrugId });
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            const asUser = await listPublic(investigationId);
            expect(asUser.status).toBe(404);
            expect(asUser.body.code).toBe('INVVACAD_002A_INVESTIGATION_NOT_FOUND');

            const asAdmin = await listAdmin(investigationId);
            expect(asAdmin.status).toBe(404);
            expect(asAdmin.body.code).toBe('INVVACAD_002B_INVESTIGATION_NOT_FOUND');

            expect((await listPublic(investigationId, 'SUPERADMIN')).status).toBe(200);
            expect((await listAdmin(investigationId, 'SUPERADMIN')).status).toBe(200);
        });

        it('keeps a USER out of the admin listing', async () => {
            const investigationId = await createInvestigation();
            expect((await listAdmin(investigationId, 'USER')).status).toBe(403);
        });
    });

    // --- 003 ----------------------------------------------------------------------------------

    describe('003 — get by id', () => {
        it('answers 404 on an id that does not exist and 400 on one that is not a UUID', async () => {
            const missing = await get(missingUuid);
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVVACAD_003_NOT_FOUND');

            expect((await get('not-a-uuid')).status).toBe(400);
        });

        it('hides a retired row from USER and ADMIN and shows it to SUPERADMIN', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);

            expect((await get(id)).status).toBe(404);
            expect((await get(id, 'ADMIN')).status).toBe(404);
            expect((await get(id, 'SUPERADMIN')).status).toBe(200);
        });

        it('hides a live row of an inactive investigation from USER and ADMIN', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await get(id)).status).toBe(404);
            expect((await get(id, 'ADMIN')).status).toBe(404);
            expect((await get(id, 'SUPERADMIN')).status).toBe(200);
        });

        it('keeps returning a row whose master was deactivated after the record', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await VaccineWhodrug.update({ isActive: false }, { where: { vaccineWhodrugId: whodrugId } });

            const found = await get(id);
            expect(found.status).toBe(200);
            // The include does not filter by isActive: a retired entry still says what was administered
            expect(found.body.data.vaccineWhodrug.vaccineWhodrugId).toBe(whodrugId);
            expect((await listPublic(investigationId)).body.data.rows[0].vaccineWhodrug).not.toBeNull();
        });
    });

    // --- 006 ----------------------------------------------------------------------------------

    describe('006 — list by case', () => {
        it('walks case -> investigation -> vaccines and returns count and rows', async () => {
            const caseId = await createCase();
            const investigationId = (await Investigation.create({
                caseId, statusItemId: statusZeroItemId, isActive: true
            })).getDataValue('investigationId');
            const whodrugId = await createWhodrug();
            await post({ investigationId, vaccineWhodrugId: whodrugId });

            const listed = await listByCase(caseId);
            expect(listed.status).toBe(200);
            expect(listed.body.data.count).toBe(1);
            expect(listed.body.data.rows[0].vaccineWhodrugId).toBe(whodrugId);
        });

        it('tells the two broken links apart with different codes', async () => {
            const missing = await listByCase(missingUuid);
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVVACAD_006_CASE_NOT_FOUND');

            const caseWithoutInvestigation = await createCase();
            const orphan = await listByCase(caseWithoutInvestigation);
            expect(orphan.status).toBe(404);
            expect(orphan.body.code).toBe('INVVACAD_006_INVESTIGATION_NOT_FOUND');
        });

        it('answers 200 with count 0 on an investigation with no vaccines, and 400 on a bad UUID', async () => {
            const caseId = await createCase();
            await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive: true });

            const empty = await listByCase(caseId);
            expect(empty.status).toBe(200);
            expect(empty.body.data).toEqual({ count: 0, rows: [] });

            expect((await request(app).get(`${ basePath }/case/no-es-uuid`).set(authHeader('USER'))).status).toBe(400);
        });
    });

    // --- 004 ----------------------------------------------------------------------------------

    describe('004 — differential update', () => {
        const seed = async (body: object = {}) => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const created = await post({ investigationId, vaccineWhodrugId: whodrugId, ...body });
            return { investigationId, whodrugId, id: created.body.data.vaccineAdministeredId };
        };

        it('writes nothing when the response of its GET is sent back whole', async () => {
            const { id } = await seed({ doseNumber: 2, notes: 'stored' });
            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id,
                model: InvestigationVaccineAdministered,
                role: 'USER',
                // Assigned by the database and governed by 005A/005B: a real form does not resend them
                strip: ['vaccineAdministeredId', 'investigationId', 'sortOrder', 'isActive', 'createdAt', 'updatedAt', 'deletedAt', 'appDetails', 'vaccineWhodrug']
            });
        });

        it('writes nothing on an empty body either', async () => {
            const { id } = await seed({ doseNumber: 1 });
            const before = await version(id);
            const beforeDetails = await detailCount(id);

            expect((await put(id, {})).status).toBe(200);

            expect(await version(id)).toBe(before);
            expect(await detailCount(id)).toBe(beforeDetails);
        });

        it('adds exactly one entry and bumps the version by one when a single field changes', async () => {
            const { id } = await seed({ notes: 'first' });
            const before = await version(id);
            const beforeDetails = await detailCount(id);

            const changed = await put(id, { notes: 'second' });
            expect(changed.status).toBe(200);
            expect(changed.body.data.notes).toBe('second');

            expect(await version(id)).toBe((before as number) + 1);
            expect(await detailCount(id)).toBe(beforeDetails + 1);
            expect((await readRow(id))!.getDataValue('updatedAt')).not.toBeNull();

            const details = (await readRow(id))!.getDataValue('appDetails') as { method: string }[];
            expect(details[details.length - 1].method).toBe('ESAVI-INVVACAD-004');
        });

        it('does not count a notes padded with whitespace as a change, and empties it with ""', async () => {
            const { id } = await seed({ notes: 'same text' });
            const before = await version(id);

            expect((await put(id, { notes: '   same text   ' })).status).toBe(200);
            expect(await version(id)).toBe(before);

            const emptied = await put(id, { notes: '' });
            expect(emptied.status).toBe(200);
            expect(emptied.body.data.notes).toBeNull();
        });

        it('answers 400 on an explicit vaccineWhodrugId null and 200 when the key is absent', async () => {
            const { id, whodrugId } = await seed();

            const nulled = await put(id, { vaccineWhodrugId: null });
            expect(nulled.status).toBe(400);
            expect(nulled.body.code).toBe('INVVACAD_004_VACCINE_REQUIRED');

            // Absent and null are not the same thing, and this pair is what demonstrates it
            const absent = await put(id, { notes: 'the key did not travel' });
            expect(absent.status).toBe(200);
            expect(absent.body.data.vaccineWhodrugId).toBe(whodrugId);
        });

        it('answers 404 on a master entry retired after the record, even when it matches', async () => {
            const { id, whodrugId } = await seed();
            await VaccineWhodrug.update({ isActive: false }, { where: { vaccineWhodrugId: whodrugId } });

            const rejected = await put(id, { vaccineWhodrugId: whodrugId });
            expect(rejected.status).toBe(404);
            expect(rejected.body.code).toBe('INVVACAD_004_WHODRUG_NOT_FOUND');
        });

        it('stores a doseNumber of 0 over a 2 and empties it with null', async () => {
            const { id } = await seed({ doseNumber: 2 });

            const zeroed = await put(id, { doseNumber: 0 });
            expect(zeroed.status).toBe(200);
            expect(zeroed.body.data.doseNumber).toBe(0);

            const emptied = await put(id, { doseNumber: null });
            expect(emptied.status).toBe(200);
            expect(emptied.body.data.doseNumber).toBeNull();
        });

        it('answers 409 when the resulting triple is taken and 200 over the row itself', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const first = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 1 });
            const second = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 2 });

            const collision = await put(second.body.data.vaccineAdministeredId, { doseNumber: 1 });
            expect(collision.status).toBe(409);
            expect(collision.body.code).toBe('INVVACAD_004_ALREADY_EXISTS');

            // Excluded with Op.ne: the row does not collide with itself
            expect((await put(first.body.data.vaccineAdministeredId, { doseNumber: 1 })).status).toBe(200);
        });

        it('ignores investigationId and sortOrder in silence, without answering 400', async () => {
            const { id, investigationId } = await seed();
            const otherInvestigationId = await createInvestigation();

            const ignored = await put(id, { investigationId: otherInvestigationId, sortOrder: 99 });
            expect(ignored.status).toBe(200);
            expect(ignored.body.data.investigationId).toBe(investigationId);
            expect(ignored.body.data.sortOrder).toBe(1);
        });

        it('answers 400 on a doseNumber out of range and 404 on an id that does not exist', async () => {
            const { id } = await seed();
            expect((await put(id, { doseNumber: -1 })).status).toBe(400);
            expect((await put(id, { doseNumber: 40000 })).status).toBe(400);

            const missing = await put(missingUuid, { notes: 'x' });
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVVACAD_004_NOT_FOUND');
        });

        it('applies the inherited visibility: 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const { id, investigationId } = await seed();
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await put(id, { notes: 'x' })).status).toBe(404);
            expect((await put(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await put(id, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
        });
    });

    // --- 005A ---------------------------------------------------------------------------------

    describe('005A — deactivate', () => {
        it('seals isActive and deletedAt, records the method and rejects the repetition', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            const beforeDetails = await detailCount(id);

            const sealed = await del(id);
            expect(sealed.status).toBe(200);
            expect(sealed.body.data).toBeUndefined();

            const row = await readRow(id);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();

            const details = row!.getDataValue('appDetails') as { method: string }[];
            expect(details).toHaveLength(beforeDetails + 1);
            expect(details[details.length - 1].method).toBe('ESAVI-INVVACAD-005A');

            const again = await del(id);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('INVVACAD_005A_ALREADY_INACTIVE');
        });

        it('is blocked by nothing: retiring a vaccine of an inactive investigation is 200', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await Investigation.update({ isActive: false }, { where: { investigationId } });

            expect((await del(id)).status).toBe(200);
        });

        it('keeps a USER out', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            expect((await del(id, 'USER')).status).toBe(403);
        });
    });

    // --- 005B ---------------------------------------------------------------------------------

    describe('005B — reactivate', () => {
        it('keeps the original sortOrder when nothing took it, and rejects the repetition', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);

            const back = await activate(id);
            expect(back.status).toBe(200);
            expect(back.body.data).toBeUndefined();

            const row = await readRow(id);
            expect(row!.getDataValue('isActive')).toBe(true);
            expect(row!.getDataValue('deletedAt')).toBeNull();
            expect(row!.getDataValue('sortOrder')).toBe(1);

            const details = row!.getDataValue('appDetails') as { method: string }[];
            expect(details[details.length - 1].method).toBe('ESAVI-INVVACAD-005B');

            const again = await activate(id);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('INVVACAD_005B_ALREADY_ACTIVE');
        });

        it('sends the reactivated row to the end of the list when its number was taken', async () => {
            const investigationId = await createInvestigation();
            const firstId = (await post({ investigationId, vaccineWhodrugId: await createWhodrug() })).body.data.vaccineAdministeredId;
            await del(firstId);

            const second = await post({ investigationId, vaccineWhodrugId: await createWhodrug() });
            expect(second.body.data.sortOrder).toBe(1);

            expect((await activate(firstId)).status).toBe(200);
            expect((await readRow(firstId))!.getDataValue('sortOrder')).toBe(2);
            expect((await readRow(second.body.data.vaccineAdministeredId))!.getDataValue('sortOrder')).toBe(1);
        });

        it('runs the uniqueness guard BEFORE the sortOrder reassignment', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const firstId = (await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 7 })).body.data.vaccineAdministeredId;
            await del(firstId);

            const reborn = await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 7 });
            expect(reborn.status).toBe(201);
            expect(reborn.body.data.sortOrder).toBe(1);

            const beforeDetails = await detailCount(firstId);
            const rejected = await activate(firstId);
            expect(rejected.status).toBe(409);
            expect(rejected.body.code).toBe('INVVACAD_005B_ALREADY_EXISTS');

            // Untouched: still retired, same sortOrder, appDetails did not grow. That is what proves
            // the guard runs before the reassignment and not after it
            const row = await readRow(firstId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();
            expect(row!.getDataValue('sortOrder')).toBe(1);
            expect(await detailCount(firstId)).toBe(beforeDetails);

            // The conflict was of state, not permanent
            await del(reborn.body.data.vaccineAdministeredId);
            expect((await activate(firstId)).status).toBe(200);
        });

        it('revalidates neither the parent chain nor the master', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);

            await Investigation.update({ isActive: false }, { where: { investigationId } });
            await VaccineWhodrug.update({ isActive: false }, { where: { vaccineWhodrugId: whodrugId } });

            expect((await activate(id)).status).toBe(200);
        });

        it('reactivates a row with a null sortOrder without touching anything', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);
            await InvestigationVaccineAdministered.update({ sortOrder: null }, { where: { vaccineAdministeredId: id } });

            expect((await activate(id)).status).toBe(200);
            expect((await readRow(id))!.getDataValue('sortOrder')).toBeNull();
        });

        it('keeps a USER out', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);
            expect((await activate(id, 'USER')).status).toBe(403);
        });
    });

    // --- 005C ---------------------------------------------------------------------------------

    describe('005C — purge', () => {
        const dumpLines = () => fs.readFileSync(logPath, 'utf-8')
            .split('\n')
            .filter(line => line.includes('ESAVI-INVVACAD-005C: Row purged by'));

        it('refuses an active row with 409 and leaves it in place', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;

            const rejected = await purge(id);
            expect(rejected.status).toBe(409);
            expect(rejected.body.code).toBe('INVVACAD_005C_STILL_ACTIVE');
            expect(await readRow(id)).not.toBeNull();
        });

        it('destroys a retired row, leaves a warn dump and answers 404 on the repetition', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId, doseNumber: 3, notes: 'gone' })).body.data.vaccineAdministeredId;
            await del(id);

            const before = dumpLines().length;
            const gone = await purge(id);
            expect(gone.status).toBe(200);
            expect(gone.body.data).toBeUndefined();
            expect(await readRow(id)).toBeNull();

            const after = dumpLines();
            expect(after.length).toBe(before + 1);
            expect(after[after.length - 1]).toContain('[WARN]');
            expect(after[after.length - 1]).toContain(id);
            expect(after[after.length - 1]).toContain('gone');

            const again = await purge(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('INVVACAD_005C_NOT_FOUND');

            // The investigation and the master entry survive intact
            expect(await Investigation.findByPk(investigationId)).not.toBeNull();
            expect(await VaccineWhodrug.findByPk(whodrugId)).not.toBeNull();
        });

        it('keeps an ADMIN out', async () => {
            const investigationId = await createInvestigation();
            const whodrugId = await createWhodrug();
            const id = (await post({ investigationId, vaccineWhodrugId: whodrugId })).body.data.vaccineAdministeredId;
            await del(id);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
        });
    });
});
