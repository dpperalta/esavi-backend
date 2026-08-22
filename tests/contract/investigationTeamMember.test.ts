import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationTeamMember, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine investigationTeamMember operations of SPEC F31. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of the parent, the sortOrder the trigger assigns and the 005B reassigns, the
 * duplicate guard over free text, and the absence of any cascade from investigation.
 */
describe('investigationTeamMember contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    let statusZeroItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Team ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`TM${ counter }${ suffix }`),
            healthSystemCode: `TM${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `TM${ counter }${ suffix }`,
            name: `Team ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `TM-${ suffix }-${ counter }`,
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

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post('/api/investigation-team-members').set(authHeader(role)).send(payload);

    const readRow = async (id: string) => await InvestigationTeamMember.findByPk(id, { paranoid: false });

    const listByInvestigation = (investigationId: string, role: TestRole = 'USER', query: string = '') =>
        request(app).get(`/api/investigation-team-members/investigation/${ investigationId }${ query }`).set(authHeader(role));

    const listAdminByInvestigation = (investigationId: string, role: TestRole = 'ADMIN', query: string = '') =>
        request(app).get(`/api/investigation-team-members/admin/investigation/${ investigationId }${ query }`).set(authHeader(role));

    const retire = (id: string) =>
        InvestigationTeamMember.update({ isActive: false, deletedAt: new Date() }, { where: { investigationTeamMemberId: id } });

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`/api/investigation-team-members/${ id }`).set(authHeader(role)).send(payload);

    const activate = (id: string, role: TestRole = 'ADMIN') =>
        request(app).patch(`/api/investigation-team-members/activate/${ id }`).set(authHeader(role));

    const remove = (id: string, role: TestRole = 'ADMIN') =>
        request(app).delete(`/api/investigation-team-members/${ id }`).set(authHeader(role));

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-team-members/case/${ caseId }`).set(authHeader(role));

    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigation-team-members/${ id }`).set(authHeader(role));

    // Mints an investigation with three members and hands back both, so the listings have
    // something ordered to read
    const seedTeam = async (): Promise<{ investigationId: string, ids: string[] }> => {
        const investigationId = await createInvestigationFixture();
        const ids: string[] = [];
        for( const fullName of ['Ana Uno', 'Ana Dos', 'Ana Tres'] ) {
            const res = await create({ investigationId, fullName });
            ids.push(res.body.data.investigationTeamMemberId);
        }
        return { investigationId, ids };
    };

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

        it('the minimal create returns 201 with the four optional columns null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, fullName: 'Ana Pérez' });

            expect(res.status).toBe(201);
            const { data } = res.body;
            expect(data.investigationId).toBe(investigationId);
            expect(data.fullName).toBe('Ana Pérez');

            for( const column of ['institutionName', 'email', 'phone', 'notes'] ) {
                expect(data[column]).toBeNull();
            }

            expect(data.isActive).toBe(true);
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVTEAM-001');
        });

        it('returns the full shape, with the investigation resolved and no sysDetails', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;

            expect(data.sysDetails).toBeUndefined();
            expect(data.investigation.sysDetails).toBeUndefined();
            expect(data.investigation.status).not.toBeNull();
            expect(data.investigation.case.caseCode).toBeDefined();
        });

        // The trigger is BEFORE INSERT only and assigns COALESCE(MAX, 0) + 1 over the live
        // rows of the same investigation. The service never sends the column: CREATE_FIELDS
        // is what keeps it out of the statement
        it('three creates over the same investigation receive sortOrder 1, 2 and 3', async () => {
            const investigationId = await createInvestigationFixture();

            const first = await create({ investigationId, fullName: 'Ana Uno' });
            const second = await create({ investigationId, fullName: 'Ana Dos' });
            const third = await create({ investigationId, fullName: 'Ana Tres' });

            expect(first.body.data.sortOrder).toBe(1);
            expect(second.body.data.sortOrder).toBe(2);
            expect(third.body.data.sortOrder).toBe(3);
        });

        it('rejects a create over an inactive investigation with 404', async () => {
            const investigationId = await createInvestigationFixture(false);
            const res = await create({ investigationId, fullName: 'Ana Pérez' });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_001_INVESTIGATION_NOT_FOUND');
        });

        it('rejects a create over an investigation that does not exist with 404', async () => {
            const res = await create({ investigationId: unknownUuid, fullName: 'Ana Pérez' });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_001_INVESTIGATION_NOT_FOUND');
        });

        it('normalizes fullName with toTitleCase', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'ana pérez' })).body;

            expect(data.fullName).toBe('Ana Pérez');
        });

        // The guard compares the ALREADY normalized value, so the case the client typed is
        // irrelevant: both of these collide with a stored 'Ana Pérez'
        it.each(['ana pérez', 'ANA PÉREZ'])('rejects a duplicated fullName sent as %s with 409', async (typed) => {
            const investigationId = await createInvestigationFixture();
            await create({ investigationId, fullName: 'Ana Pérez' });

            const res = await create({ investigationId, fullName: typed });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVTEAM_001_ALREADY_EXISTS');
            expect(res.body.message).toContain('Ana Pérez');
        });

        it('admits the same fullName in a different investigation', async () => {
            const first = await createInvestigationFixture();
            const second = await createInvestigationFixture();
            await create({ investigationId: first, fullName: 'Ana Pérez' });

            const res = await create({ investigationId: second, fullName: 'Ana Pérez' });

            expect(res.status).toBe(201);
        });

        // The duplicate guard compares against ACTIVE rows only: registering the same person
        // again is the normal way of undoing a mistaken create without going through 005B
        it('admits a fullName that collides with an inactive row', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await InvestigationTeamMember.update(
                { isActive: false, deletedAt: new Date() },
                { where: { investigationTeamMemberId: data.investigationTeamMemberId } }
            );

            const res = await create({ investigationId, fullName: 'Ana Pérez' });

            expect(res.status).toBe(201);
        });

        it('lowercases and trims email, and stores institutionName as typed', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({
                investigationId,
                fullName: 'Ana Pérez',
                email: '  Ana@X.CL ',
                institutionName: '  MINSAL  ',
                phone: '  +56 9 1234 5678  ',
                notes: '  una nota  '
            })).body;

            expect(data.email).toBe('ana@x.cl');
            expect(data.institutionName).toBe('MINSAL');
            expect(data.phone).toBe('+56 9 1234 5678');
            expect(data.notes).toBe('una nota');
        });

        it('rejects a body without fullName with 400 from the validator', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(400);
        });

        it('rejects an invalid email with 400 from the validator', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, fullName: 'Ana Pérez', email: 'no-es-correo' });

            expect(res.status).toBe(400);
        });

        // The column is not declared in any validator and is not in the input type: it is
        // ignored in silence, and the trigger keeps assigning it
        it('ignores a sortOrder sent in the body', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, fullName: 'Ana Pérez', sortOrder: 99 });

            expect(res.status).toBe(201);
            expect(res.body.data.sortOrder).toBe(1);
        });

        it('writes the audit entry and lets the trigger open sysDetails', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;

            const row = await readRow(data.investigationTeamMemberId);
            const sysDetails = row!.getDataValue('sysDetails') as { version?: number } | null;
            expect(sysDetails?.version).toBe(1);
        });
    });

    describe('002A and 002B — the two listings by investigation', () => {

        it('002A returns { count, rows } ordered by sortOrder ascending', async () => {
            const { investigationId } = await seedTeam();
            const res = await listByInvestigation(investigationId);

            expect(res.status).toBe(200);
            expect(res.body.data.count).toBe(3);
            expect(res.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
            expect(res.body.data.rows.map((r: { fullName: string }) => r.fullName))
                .toEqual(['Ana Uno', 'Ana Dos', 'Ana Tres']);
        });

        // The difference between the two listings, and the reason the new index exists: 002B
        // reads precisely the rows the partial unique index of sortOrder leaves out
        it('002A hides a retired member and 002B returns it', async () => {
            const { investigationId, ids } = await seedTeam();
            await retire(ids[1]);

            const active = await listByInvestigation(investigationId);
            const all = await listAdminByInvestigation(investigationId);

            expect(active.body.data.count).toBe(2);
            expect(active.body.data.rows.map((r: { fullName: string }) => r.fullName))
                .toEqual(['Ana Uno', 'Ana Tres']);
            expect(all.body.data.count).toBe(3);
            expect(all.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
        });

        it('an investigation with no members returns 200 with count 0, not 404', async () => {
            const investigationId = await createInvestigationFixture();

            const active = await listByInvestigation(investigationId);
            const all = await listAdminByInvestigation(investigationId);

            expect(active.status).toBe(200);
            expect(active.body.data).toEqual({ count: 0, rows: [] });
            expect(all.status).toBe(200);
            expect(all.body.data.count).toBe(0);
        });

        it('rejects a USER on 002B with 403', async () => {
            const { investigationId } = await seedTeam();
            const res = await listAdminByInvestigation(investigationId, 'USER');

            expect(res.status).toBe(403);
        });

        // The inherited visibility over the :id of the route, applied before reading anything
        it.each([
            ['USER' as TestRole, 404],
            ['ADMIN' as TestRole, 404],
            ['SUPERADMIN' as TestRole, 200]
        ])('002A over a retired investigation answers %s -> %i', async (role, status) => {
            const { investigationId } = await seedTeam();
            await retireInvestigation(investigationId);

            const res = await listByInvestigation(investigationId, role);

            expect(res.status).toBe(status);
            if( status === 404 ) expect(res.body.code).toBe('INVTEAM_002A_INVESTIGATION_NOT_FOUND');
        });

        it.each([
            ['ADMIN' as TestRole, 404],
            ['SUPERADMIN' as TestRole, 200]
        ])('002B over a retired investigation answers %s -> %i', async (role, status) => {
            const { investigationId } = await seedTeam();
            await retireInvestigation(investigationId);

            const res = await listAdminByInvestigation(investigationId, role);

            expect(res.status).toBe(status);
            if( status === 404 ) expect(res.body.code).toBe('INVTEAM_002B_INVESTIGATION_NOT_FOUND');
        });

        it('every row carries the investigation with its status and case, and no sysDetails', async () => {
            const { investigationId } = await seedTeam();
            const { data } = (await listByInvestigation(investigationId)).body;

            for( const row of data.rows ) {
                expect(row.sysDetails).toBeUndefined();
                expect(row.investigation.investigationId).toBe(investigationId);
                expect(row.investigation.status).not.toBeNull();
                expect(row.investigation.case.caseCode).toBeDefined();
                expect(row.investigation.sysDetails).toBeUndefined();
            }
        });

        it('paginates with limit and offset', async () => {
            const { investigationId } = await seedTeam();
            const res = await listByInvestigation(investigationId, 'USER', '?limit=2&offset=1');

            expect(res.body.data.count).toBe(3);
            expect(res.body.data.rows).toHaveLength(2);
            expect(res.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([2, 3]);
        });

        it('rejects a non-UUID investigation id with 400', async () => {
            const res = await listByInvestigation('no-es-uuid');

            expect(res.status).toBe(400);
        });

        it('answers 404 over an investigation that does not exist', async () => {
            const res = await listByInvestigation(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_002A_INVESTIGATION_NOT_FOUND');
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape of §3.7 with the investigation resolved', async () => {
            const { ids, investigationId } = await seedTeam();
            const res = await getById(ids[0]);

            expect(res.status).toBe(200);
            const { data } = res.body;
            expect(data.investigationTeamMemberId).toBe(ids[0]);
            expect(data.fullName).toBe('Ana Uno');
            expect(data.sortOrder).toBe(1);
            expect(data.isActive).toBe(true);
            expect(data.investigation.investigationId).toBe(investigationId);
            expect(data.investigation.status).not.toBeNull();
            expect(data.investigation.case.caseCode).toBeDefined();
        });

        it('never returns sysDetails, neither of the member nor of the investigation', async () => {
            const { ids } = await seedTeam();
            const { data } = (await getById(ids[0])).body;

            expect(data.sysDetails).toBeUndefined();
            expect(data.investigation.sysDetails).toBeUndefined();
        });

        it('answers 404 over an ID that does not exist', async () => {
            const res = await getById(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_003_NOT_FOUND');
        });

        // The two conditions the same flag relaxes: the isActive of the row and the isActive
        // of its investigation. A USER and an ADMIN see neither, a SUPERADMIN sees both
        it.each([
            ['USER' as TestRole, 404],
            ['ADMIN' as TestRole, 404],
            ['SUPERADMIN' as TestRole, 200]
        ])('a member of a retired investigation answers %s -> %i', async (role, status) => {
            const { ids, investigationId } = await seedTeam();
            await retireInvestigation(investigationId);

            const res = await getById(ids[0], role);

            expect(res.status).toBe(status);
        });

        it.each([
            ['USER' as TestRole, 404],
            ['ADMIN' as TestRole, 404],
            ['SUPERADMIN' as TestRole, 200]
        ])('a retired member answers %s -> %i', async (role, status) => {
            const { ids } = await seedTeam();
            await retire(ids[0]);

            const res = await getById(ids[0], role);

            expect(res.status).toBe(status);
        });

        // The route order of §3.4: /:id is declared after every literal path, so the validator
        // of the literal route answers and this one never sees the request
        it('does not capture the literal paths as an :id', async () => {
            const activate = await request(app)
                .get('/api/investigation-team-members/activate/algo').set(authHeader('USER'));
            const notUuid = await getById('no-es-uuid');

            expect(activate.status).not.toBe(200);
            expect(notUuid.status).toBe(400);
        });
    });

    describe('006 — list by case', () => {

        it('returns { count, rows } for a case with investigation and members', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, fullName: 'Ana Uno' });
            await create({ investigationId, fullName: 'Ana Dos' });

            const res = await getByCase(caseId);

            expect(res.status).toBe(200);
            expect(res.body.data.count).toBe(2);
            expect(res.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2]);
        });

        it('answers 404 CASE_NOT_FOUND over a caseId that does not exist', async () => {
            const res = await getByCase(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_006_CASE_NOT_FOUND');
        });

        it('answers 404 CASE_NOT_FOUND over an inactive case', async () => {
            const caseId = await createCaseFixture(false);
            await createInvestigationForCase(caseId);

            const res = await getByCase(caseId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_006_CASE_NOT_FOUND');
        });

        it('answers 404 INVESTIGATION_NOT_FOUND over a case with no investigation', async () => {
            const caseId = await createCaseFixture();

            const res = await getByCase(caseId);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_006_INVESTIGATION_NOT_FOUND');
        });

        // The two codes have to be distinct: they are two different actions on the user's side
        it('the two 404 codes are different from each other', async () => {
            const missingCase = await getByCase(unknownUuid);
            const caseWithoutInvestigation = await getByCase(await createCaseFixture());

            expect(missingCase.body.code).not.toBe(caseWithoutInvestigation.body.code);
        });

        it('a retired investigation answers 404 for USER and 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, fullName: 'Ana Uno' });
            await retireInvestigation(investigationId);

            expect((await getByCase(caseId, 'USER')).status).toBe(404);
            expect((await getByCase(caseId, 'ADMIN')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

        it('an investigation with no members returns 200 with count 0, not 404', async () => {
            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);

            const res = await getByCase(caseId);

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ count: 0, rows: [] });
        });

        it('does not return a retired member', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            const { data } = (await create({ investigationId, fullName: 'Ana Uno' })).body;
            await create({ investigationId, fullName: 'Ana Dos' });
            await retire(data.investigationTeamMemberId);

            const res = await getByCase(caseId);

            expect(res.body.data.count).toBe(1);
            expect(res.body.data.rows[0].fullName).toBe('Ana Dos');
        });

        it('rejects a non-UUID caseId with 400', async () => {
            const res = await getByCase('no-es-uuid');

            expect(res.status).toBe(400);
        });
    });

    describe('004 — update, differential', () => {

        // Mints one member and hands back its id, so the update tests do not repeat the seed
        const seedMember = async (payload: Record<string, unknown> = {}): Promise<string> => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, fullName: 'Ana Pérez', ...payload });
            expect(res.status).toBe(201);
            return res.body.data.investigationTeamMemberId;
        };

        // The strongest case of SPEC F12: the record is read with a GET and sent back whole
        it('a PUT resending the response of its own GET writes nothing', async () => {
            const id = await seedMember({ institutionName: 'MINSAL', email: 'ana@x.cl', notes: 'nota' });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/investigation-team-members',
                id,
                model: InvestigationTeamMember,
                role: 'USER'
            });
        });

        it('a PUT with an empty body writes nothing', async () => {
            const id = await seedMember();
            const versionBefore = await versionOf(id);

            const res = await update(id, {});

            expect(res.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        // The criterion the normalization before the comparison protects: the value is compared
        // already passed through toTitleCase, so this is not a change
        it('a PUT with fullName "ana pérez" over a stored "Ana Pérez" writes nothing', async () => {
            const id = await seedMember();
            const versionBefore = await versionOf(id);

            const res = await update(id, { fullName: 'ana pérez' });

            expect(res.status).toBe(200);
            expect(res.body.data.fullName).toBe('Ana Pérez');
            expect(await versionOf(id)).toBe(versionBefore);
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        it('a PUT with email "ANA@X.CL" over a stored "ana@x.cl" writes nothing', async () => {
            const id = await seedMember({ email: 'ana@x.cl' });
            const versionBefore = await versionOf(id);

            const res = await update(id, { email: 'ANA@X.CL' });

            expect(res.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('a PUT that changes one field adds exactly one entry and bumps the version by 1', async () => {
            const id = await seedMember();
            const versionBefore = await versionOf(id);

            const res = await update(id, { notes: 'nueva nota' });

            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('nueva nota');
            expect(await versionOf(id)).toBe((versionBefore ?? 0) + 1);

            const appDetails = await appDetailsOf(id);
            expect(appDetails).toHaveLength(2);
            expect(appDetails[0].method).toBe('ESAVI-INVTEAM-001');
            expect(appDetails[1].method).toBe('ESAVI-INVTEAM-004');
        });

        it('writes only the field that changed', async () => {
            const id = await seedMember({ institutionName: 'MINSAL', phone: '+56 9 1111' });

            const { data } = (await update(id, { notes: 'nueva nota' })).body;

            expect(data.institutionName).toBe('MINSAL');
            expect(data.phone).toBe('+56 9 1111');
            expect(data.fullName).toBe('Ana Pérez');
        });

        // The four nullable fields: an explicit null erases a stored value, and that IS a write
        it.each(['institutionName', 'email', 'phone', 'notes'])('%s: null empties the field and writes', async (field) => {
            const id = await seedMember({ institutionName: 'MINSAL', email: 'ana@x.cl', phone: '+56 9 1111', notes: 'nota' });
            const versionBefore = await versionOf(id);

            const res = await update(id, { [field]: null });

            expect(res.status).toBe(200);
            expect(res.body.data[field]).toBeNull();
            expect(await versionOf(id)).toBe((versionBefore ?? 0) + 1);
        });

        it('rejects fullName: null with 400 and writes nothing', async () => {
            const id = await seedMember();
            const versionBefore = await versionOf(id);

            const res = await update(id, { fullName: null });

            expect(res.status).toBe(400);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        // The two immutable fields: ignored in silence, never a 400
        it('ignores investigationId and sortOrder sent in the body', async () => {
            const id = await seedMember();
            const otherInvestigation = await createInvestigationFixture();
            const before = await readRow(id);

            const res = await update(id, { investigationId: otherInvestigation, sortOrder: 99 });

            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(before!.getDataValue('investigationId'));
            expect(res.body.data.sortOrder).toBe(1);
        });

        it('answers 404 over an ID that does not exist', async () => {
            const res = await update(unknownUuid, { notes: 'x' });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_004_NOT_FOUND');
        });

        it.each([
            ['USER' as TestRole, 404],
            ['SUPERADMIN' as TestRole, 200]
        ])('a member of a retired investigation answers %s -> %i', async (role, status) => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await retireInvestigation(investigationId);

            const res = await update(data.investigationTeamMemberId, { notes: 'x' }, role);

            expect(res.status).toBe(status);
        });

        it('rejects a rename colliding with another ACTIVE member with 409', async () => {
            const investigationId = await createInvestigationFixture();
            await create({ investigationId, fullName: 'Ana Uno' });
            const { data } = (await create({ investigationId, fullName: 'Ana Dos' })).body;

            const res = await update(data.investigationTeamMemberId, { fullName: 'Ana Uno' });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVTEAM_004_ALREADY_EXISTS');
            expect(res.body.message).toContain('Ana Uno');
        });

        it('admits a rename colliding with an INACTIVE member', async () => {
            const investigationId = await createInvestigationFixture();
            const first = (await create({ investigationId, fullName: 'Ana Uno' })).body.data;
            const second = (await create({ investigationId, fullName: 'Ana Dos' })).body.data;
            await retire(first.investigationTeamMemberId);

            const res = await update(second.investigationTeamMemberId, { fullName: 'Ana Uno' });

            expect(res.status).toBe(200);
            expect(res.body.data.fullName).toBe('Ana Uno');
        });

        // The guard excludes the row itself, or renaming a member to the name it already has
        // would collide with itself
        it('renaming a row to its own name does not fire the 409', async () => {
            const id = await seedMember();

            const res = await update(id, { fullName: 'Ana Pérez' });

            expect(res.status).toBe(200);
        });

        it('the collision is checked only inside the same investigation', async () => {
            const first = await createInvestigationFixture();
            const second = await createInvestigationFixture();
            await create({ investigationId: first, fullName: 'Ana Uno' });
            const { data } = (await create({ investigationId: second, fullName: 'Ana Dos' })).body;

            const res = await update(data.investigationTeamMemberId, { fullName: 'Ana Uno' });

            expect(res.status).toBe(200);
        });
    });

    describe('005A — deactivate', () => {

        it('seals isActive and deletedAt, and records the audit entry', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;

            const res = await remove(data.investigationTeamMemberId);

            expect(res.status).toBe(200);
            const row = await readRow(data.investigationTeamMemberId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();

            const appDetails = await appDetailsOf(data.investigationTeamMemberId);
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-INVTEAM-005A');
        });

        it('deactivating twice answers 409 ALREADY_INACTIVE', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await remove(data.investigationTeamMemberId);

            const res = await remove(data.investigationTeamMemberId);

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVTEAM_005A_ALREADY_INACTIVE');
        });

        it('answers 404 over an ID that does not exist', async () => {
            const res = await remove(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_005A_NOT_FOUND');
        });

        it('rejects a USER with 403', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;

            const res = await remove(data.investigationTeamMemberId, 'USER');

            expect(res.status).toBe(403);
        });

        // The seal frees the sortOrder from the partial unique index, which is correct and
        // deliberate: the gap stays available for the next member
        it('after deactivating, a new create reuses the freed sortOrder', async () => {
            const investigationId = await createInvestigationFixture();
            await create({ investigationId, fullName: 'Ana Uno' });
            const second = (await create({ investigationId, fullName: 'Ana Dos' })).body.data;
            expect(second.sortOrder).toBe(2);

            await remove(second.investigationTeamMemberId);
            const third = (await create({ investigationId, fullName: 'Ana Tres' })).body.data;

            expect(third.sortOrder).toBe(2);
        });

        // The difference with F29 and F30: 005A operates over the state of the row itself, so it
        // does not apply the inherited visibility
        it('deactivating the member of a retired investigation works', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await retireInvestigation(investigationId);

            const res = await remove(data.investigationTeamMemberId);

            expect(res.status).toBe(200);
        });

        // The table is a leaf of the graph: nothing hangs from a member, so nothing blocks it
        it('is blocked by nothing — no previous query at all', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({
                investigationId, fullName: 'Ana Pérez', institutionName: 'MINSAL', email: 'ana@x.cl', notes: 'nota'
            })).body;

            expect((await remove(data.investigationTeamMemberId)).status).toBe(200);
        });
    });

    describe('005B — reactivate, with sortOrder reassignment', () => {

        // THE scenario that breaks a clean delegation, and the reason 005B does not simply hand
        // over to setEntityActiveStatusService. The row that is retired has to be the one holding
        // the HIGHEST sortOrder: setSortOrderByParent assigns COALESCE(MAX, 0) + 1 over the live
        // rows, so it does not fill gaps
        it('reactivating after another member took the freed sortOrder answers 200', async () => {
            const investigationId = await createInvestigationFixture();
            const a = (await create({ investigationId, fullName: 'Ana Uno' })).body.data;
            const b = (await create({ investigationId, fullName: 'Ana Dos' })).body.data;
            expect([a.sortOrder, b.sortOrder]).toEqual([1, 2]);

            await remove(b.investigationTeamMemberId);
            const c = (await create({ investigationId, fullName: 'Ana Tres' })).body.data;
            expect(c.sortOrder).toBe(2);

            const res = await activate(b.investigationTeamMemberId);

            expect(res.status).toBe(200);
            const row = await readRow(b.investigationTeamMemberId);
            expect(row!.getDataValue('isActive')).toBe(true);
            expect(row!.getDataValue('deletedAt')).toBeNull();
            // B reappears at the end of the list, with a number nobody holds
            expect(row!.getDataValue('sortOrder')).toBe(3);
        });

        // The other variant: retiring the member that is NOT the last one leaves a gap the
        // trigger never fills, so the reactivation finds no collision
        it('reactivating when the gap was not reused leaves sortOrder untouched', async () => {
            const investigationId = await createInvestigationFixture();
            const a = (await create({ investigationId, fullName: 'Ana Uno' })).body.data;
            await create({ investigationId, fullName: 'Ana Dos' });

            await remove(a.investigationTeamMemberId);
            const c = (await create({ investigationId, fullName: 'Ana Tres' })).body.data;
            expect(c.sortOrder).toBe(3);

            const res = await activate(a.investigationTeamMemberId);

            expect(res.status).toBe(200);
            expect((await readRow(a.investigationTeamMemberId))!.getDataValue('sortOrder')).toBe(1);
        });

        it('reactivating with no collision does not touch sortOrder', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await remove(data.investigationTeamMemberId);

            const res = await activate(data.investigationTeamMemberId);

            expect(res.status).toBe(200);
            expect((await readRow(data.investigationTeamMemberId))!.getDataValue('sortOrder')).toBe(1);
        });

        it('records the audit entry with method ESAVI-INVTEAM-005B', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await remove(data.investigationTeamMemberId);
            await activate(data.investigationTeamMemberId);

            const appDetails = await appDetailsOf(data.investigationTeamMemberId);
            expect(appDetails.map(e => e.method))
                .toEqual(['ESAVI-INVTEAM-001', 'ESAVI-INVTEAM-005A', 'ESAVI-INVTEAM-005B']);
        });

        it('reactivating one that is already active answers 409', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;

            const res = await activate(data.investigationTeamMemberId);

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVTEAM_005B_ALREADY_ACTIVE');
        });

        it('answers 404 over an ID that does not exist', async () => {
            const res = await activate(unknownUuid);

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVTEAM_005B_NOT_FOUND');
        });

        it('rejects a USER with 403', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await remove(data.investigationTeamMemberId);

            const res = await activate(data.investigationTeamMemberId, 'USER');

            expect(res.status).toBe(403);
        });

        // 005B does not revalidate the chain: the state of the row does not depend on the parent
        it('reactivating one whose investigation was retired meanwhile answers 200', async () => {
            const investigationId = await createInvestigationFixture();
            const { data } = (await create({ investigationId, fullName: 'Ana Pérez' })).body;
            await remove(data.investigationTeamMemberId);
            await retireInvestigation(investigationId);

            const res = await activate(data.investigationTeamMemberId);

            expect(res.status).toBe(200);
        });

        // The consequence assumed in §6, explicit here so nobody "fixes" it by accident: 005B is a
        // recovery operation, and blocking it would leave rows unrecoverable through that route
        it('reactivating one whose fullName is already live answers 200 and leaves the duplicate', async () => {
            const investigationId = await createInvestigationFixture();
            const first = (await create({ investigationId, fullName: 'Ana Pérez' })).body.data;
            await remove(first.investigationTeamMemberId);
            await create({ investigationId, fullName: 'Ana Pérez' });

            const res = await activate(first.investigationTeamMemberId);

            expect(res.status).toBe(200);

            const live = await listByInvestigation(investigationId);
            expect(live.body.data.rows.filter((r: { fullName: string }) => r.fullName === 'Ana Pérez'))
                .toHaveLength(2);
        });
    });
});
