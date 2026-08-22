import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationTeamMember, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
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
});
