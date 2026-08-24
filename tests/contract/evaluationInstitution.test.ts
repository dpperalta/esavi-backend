import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, EvaluationInstitution, HealthFacility, Investigation, InvestigationClinicalEvaluation, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the eight evaluationInstitution operations of SPEC F35. It walks the entity
 * end to end and covers what cannot be checked by hand reliably: the inherited visibility of a
 * two hop chain whose intermediate link has no isActive column, the sortOrder the database assigns
 * and the collision the reactivation has to resolve, the identification rule evaluated over the
 * resulting state, and the two log dumps of foreign services.
 *
 * Four things separate this entity from its sisters and get deliberate coverage:
 *
 *  - It is the FIRST COLLECTION of the repository with ENCRYPTED columns. personName and
 *    personContact are stored as the esaviCrypt ciphertext — the first title cased, the second only
 *    trimmed — and the diff compares in CLEAR. Both listings therefore have to decrypt row by row,
 *    which is asserted over every row of both, and a PUT resending the name a GET returned must
 *    leave the column identical byte for byte.
 *  - Its sortOrder is the ONLY one of the nine tables in the setSortOrderByParent loop that is
 *    nullable and carries no DEFAULT 0, so the create needs no CREATE_FIELDS and a row may
 *    legitimately hold no number at all — a case the 005B has to skip instead of resolve.
 *  - It carries TWO identifiers that coexist, healthFacilityId and institutionName, of which at
 *    least one must survive. The rule is evaluated over the RESULTING state and lives in the
 *    service, so the 004 cases are the ones that pin it down.
 *  - Its two log dumps are COUNTS and never snapshots, and here that is not aesthetic: a snapshot
 *    per row would write the ciphertext of two PII columns into esaviLog.log. Both dump tests
 *    assert the absence explicitly.
 *
 * The double hop of the institution type gets coverage of its own: the foreign key of the DDL
 * points at catalogItem without distinguishing the catalogType, so an item of `sex` accepted as an
 * institution type is the failure only that filter prevents.
 */
describe('evaluationInstitution contract', () => {
    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/evaluation-institutions';
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

    const createFacility = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        return (await HealthFacility.create({
            localCode: `EI${ counter }${ suffix }`,
            name: `Facility ${ counter } ${ suffix }`,
            isActive
        })).getDataValue('healthFacilityId');
    };

    const createEvaluation = async (investigationActive: boolean = true, sealed: boolean = false): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Inst ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`EI${ counter }${ suffix }`),
            healthSystemCode: `EI${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facilityId = await createFacility();
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facilityId,
            caseCode: `EI-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        const investigationId = (await Investigation.create({
            caseId: esaviCase.getDataValue('caseId'),
            statusItemId: statusZeroItemId,
            isActive: investigationActive
        })).getDataValue('investigationId');
        await InvestigationClinicalEvaluation.create({
            investigationId,
            ...( sealed ? { deletedAt: new Date() } : {} )
        });
        return investigationId;
    };

    const create = (payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    it('201 with sortOrder 1 then 2, and the INSERT leaves sortOrder to the trigger', async () => {
        const investigationId = await createEvaluation();
        const first = await create({ investigationId, institutionName: 'MINSAL' });
        expect(first.status).toBe(201);
        expect(first.body.data.sortOrder).toBe(1);
        expect(first.body.data.isActive).toBe(true);
        expect(first.body.data.healthFacilityId).toBeNull();
        expect(first.body.data.personName).toBeNull();
        expect(first.body.data.personContact).toBeNull();
        expect(first.body.data.evaluationInstitutionTypeItemId).toBeNull();
        expect(first.body.data.healthFacility).toBeNull();
        expect(first.body.data.institutionType).toBeNull();
        expect(first.body.data.sysDetails).toBeUndefined();
        expect(first.body.data.appDetails).toHaveLength(1);
        expect(first.body.data.appDetails[0].method).toBe('ESAVI-EVALINST-001');

        const second = await create({ investigationId, institutionName: 'Otra' });
        expect(second.status).toBe(201);
        expect(second.body.data.sortOrder).toBe(2);
    });

    it('400 EVALINST_001_IDENTIFICATION_REQUIRED without either identifier', async () => {
        const investigationId = await createEvaluation();
        const res = await create({ investigationId, personName: 'Juan', personContact: '555', notes: 'x' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('EVALINST_001_IDENTIFICATION_REQUIRED');
    });

    it('404 for an inactive or unknown healthFacilityId', async () => {
        const investigationId = await createEvaluation();
        const inactive = await createFacility(false);
        const res = await create({ investigationId, healthFacilityId: inactive });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('EVALINST_001_HEALTH_FACILITY_NOT_FOUND');

        const unknown = await create({ investigationId, healthFacilityId: '00000000-0000-4000-8000-000000000000' });
        expect(unknown.status).toBe(404);
        expect(unknown.body.code).toBe('EVALINST_001_HEALTH_FACILITY_NOT_FOUND');
    });

    it('404 for a catalogItem of another catalog — the double hop', async () => {
        const investigationId = await createEvaluation();
        const sexType = await CatalogType.findOne({ where: { code: 'sex' } });
        const sexItem = await CatalogItem.findOne({ where: { catalogTypeId: sexType!.getDataValue('catalogTypeId') } });
        const res = await create({
            investigationId,
            institutionName: 'X',
            evaluationInstitutionTypeItemId: sexItem!.getDataValue('catalogItemId')
        });
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('EVALINST_001_INSTITUTION_TYPE_NOT_FOUND');
    });

    it('201 with a real evaluationInstitutionType item, and the type comes back with three fields', async () => {
        const investigationId = await createEvaluation();
        const type = await CatalogType.findOne({ where: { code: 'evaluationInstitutionType' } });
        expect(type).not.toBeNull();
        const items = await CatalogItem.findAll({ where: { catalogTypeId: type!.getDataValue('catalogTypeId') } });
        expect(items).toHaveLength(5);
        const facilityId = await createFacility();
        const res = await create({
            investigationId,
            healthFacilityId: facilityId,
            institutionName: 'MINSAL',
            evaluationInstitutionTypeItemId: items[0].getDataValue('catalogItemId')
        });
        expect(res.status).toBe(201);
        expect(Object.keys(res.body.data.institutionType).sort()).toEqual(['catalogItemId', 'code', 'name']);
        expect(Object.keys(res.body.data.healthFacility).sort()).toEqual(['healthFacilityId', 'isActive', 'localCode', 'name']);
        // Both identifiers coexist and neither is erased
        expect(res.body.data.institutionName).toBe('MINSAL');
        expect(res.body.data.healthFacilityId).toBe(facilityId);
    });

    it('404 EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND in the three cases, SUPERADMIN included', async () => {
        // 1. no clinical evaluation row
        const patient = await Patient.create({
            firstName: esaviCrypt('No'), lastName: esaviCrypt(`Eval ${ suffix }`),
            documentNumber: esaviCrypt(`NE${ suffix }`), healthSystemCode: `NE${ suffix }`, birthDate: '2000-01-01'
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: await createFacility(),
            caseCode: `NE-${ suffix }`, reportDate: new Date().toISOString().slice(0, 10), eventDate: '2024-01-01'
        });
        const orphan = (await Investigation.create({ caseId: esaviCase.getDataValue('caseId'), statusItemId: statusZeroItemId })).getDataValue('investigationId');

        for (const [label, investigationId] of [
            ['no evaluation', orphan],
            ['sealed evaluation', await createEvaluation(true, true)],
            ['inactive investigation', await createEvaluation(false, false)]
        ] as [string, string][]) {
            for (const role of ['USER', 'SUPERADMIN'] as TestRole[]) {
                const res = await create({ investigationId, institutionName: 'X' }, role);
                expect([label, res.status, res.body.code])
                    .toEqual([label, 404, 'EVALINST_001_CLINICAL_EVALUATION_NOT_FOUND']);
            }
        }
    });

    it('409 on a repeated active facility, 201 when the holder is inactive', async () => {
        const investigationId = await createEvaluation();
        const facilityId = await createFacility();
        const first = await create({ investigationId, healthFacilityId: facilityId });
        expect(first.status).toBe(201);

        const dup = await create({ investigationId, healthFacilityId: facilityId });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('EVALINST_001_ALREADY_EXISTS');

        await EvaluationInstitution.update(
            { isActive: false },
            { where: { evaluationInstitutionId: first.body.data.evaluationInstitutionId } }
        );
        const again = await create({ investigationId, healthFacilityId: facilityId });
        expect(again.status).toBe(201);
    });

    it('two free text institutions with the same name are two rows', async () => {
        const investigationId = await createEvaluation();
        expect((await create({ investigationId, institutionName: 'Hospital del Niño' })).status).toBe(201);
        expect((await create({ investigationId, institutionName: 'Hospital del Niño' })).status).toBe(201);
        expect(await EvaluationInstitution.count({ where: { investigationId } })).toBe(2);
    });

    it('MINSAL stays MINSAL, personName is title cased and both PII columns are stored encrypted', async () => {
        const investigationId = await createEvaluation();
        const res = await create({
            investigationId,
            institutionName: '  MINSAL  ',
            personName: '  juan pérez  ',
            personContact: '  555-1234  '
        });
        expect(res.status).toBe(201);
        expect(res.body.data.institutionName).toBe('MINSAL');
        expect(res.body.data.personName).toBe('Juan Pérez');
        expect(res.body.data.personContact).toBe('555-1234');

        const row = await EvaluationInstitution.findByPk(res.body.data.evaluationInstitutionId, { paranoid: false });
        expect(row!.getDataValue('personName')).toBe(esaviCrypt('Juan Pérez'));
        expect(row!.getDataValue('personName')).not.toBe('Juan Pérez');
        expect(row!.getDataValue('personContact')).toBe(esaviCrypt('555-1234'));
        expect(row!.getDataValue('personContact')).not.toBe('555-1234');
    });

    it('201 over a clinical evaluation declaring receivedMedicalAttention NO', async () => {
        const investigationId = await createEvaluation();
        await InvestigationClinicalEvaluation.update(
            { receivedMedicalAttention: 'NO' },
            { where: { investigationId } }
        );
        expect((await create({ investigationId, institutionName: 'X' })).status).toBe(201);
    });

    // ---- step 7: the two listings ----

    const list = (investigationId: string, query: string = '', role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/investigation/${ investigationId }${ query }`).set(authHeader(role));

    const listAdmin = (investigationId: string, query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`${ basePath }/admin/investigation/${ investigationId }${ query }`).set(authHeader(role));

    it('002A returns only active rows, 002B also the inactive and the sealed ones', async () => {
        const investigationId = await createEvaluation();
        const a = await create({ investigationId, institutionName: 'Uno', personName: 'ana lopez', personContact: '111' });
        const b = await create({ investigationId, institutionName: 'Dos', personName: 'bea ruiz', personContact: '222' });
        const c = await create({ investigationId, institutionName: 'Tres' });
        expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);

        await EvaluationInstitution.update({ isActive: false }, { where: { evaluationInstitutionId: b.body.data.evaluationInstitutionId } });
        await EvaluationInstitution.update({ isActive: false, deletedAt: new Date() }, { where: { evaluationInstitutionId: c.body.data.evaluationInstitutionId } });

        const active = await list(investigationId);
        expect(active.status).toBe(200);
        expect(active.body.data.count).toBe(1);
        expect(active.body.data.rows.map((r: { institutionName: string }) => r.institutionName)).toEqual(['Uno']);

        const all = await listAdmin(investigationId);
        expect(all.status).toBe(200);
        expect(all.body.data.count).toBe(3);
        // ordered by sortOrder ascending
        expect(all.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder)).toEqual([1, 2, 3]);
        expect(all.body.data.rows.map((r: { institutionName: string }) => r.institutionName)).toEqual(['Uno', 'Dos', 'Tres']);

        // no ciphertext in any row of either listing
        const cipherA = esaviCrypt('Ana Lopez');
        for (const rows of [active.body.data.rows, all.body.data.rows]) {
            for (const row of rows) {
                expect(row.personName).not.toBe(cipherA);
                if( row.personName !== null ) expect(row.personName).toMatch(/^[A-Za-zÀ-ÿ ]+$/);
            }
        }
        expect(all.body.data.rows[0].personName).toBe('Ana Lopez');
        expect(all.body.data.rows[0].personContact).toBe('111');
        expect(all.body.data.rows[1].personName).toBe('Bea Ruiz');
        expect(all.body.data.rows[2].personName).toBeNull();
    });

    it('an evaluation with no institutions is 200 with { count: 0, rows: [] }', async () => {
        const investigationId = await createEvaluation();
        const res = await list(investigationId);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ count: 0, rows: [] });
    });

    it('404 for an investigationId with no clinical evaluation, with any role', async () => {
        const patient = await Patient.create({
            firstName: esaviCrypt('L'), lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`LS${ suffix }`), healthSystemCode: `LS${ suffix }`, birthDate: '2000-01-01'
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'), healthFacilityId: await createFacility(),
            caseCode: `LS-${ suffix }`, reportDate: new Date().toISOString().slice(0, 10), eventDate: '2024-01-01'
        });
        const orphan = (await Investigation.create({ caseId: esaviCase.getDataValue('caseId'), statusItemId: statusZeroItemId })).getDataValue('investigationId');

        for (const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const res = await list(orphan, '', role);
            expect([role, res.status, res.body.code]).toEqual([role, 404, 'EVALINST_002A_CLINICAL_EVALUATION_NOT_FOUND']);
        }
        for (const role of ['ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const res = await listAdmin(orphan, '', role);
            expect([role, res.status, res.body.code]).toEqual([role, 404, 'EVALINST_002B_CLINICAL_EVALUATION_NOT_FOUND']);
        }
    });

    it('an inactive investigation is 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
        const investigationId = await createEvaluation();
        await create({ investigationId, institutionName: 'Uno' });
        await Investigation.update({ isActive: false }, { where: { investigationId } });

        expect((await list(investigationId, '', 'USER')).status).toBe(404);
        expect((await list(investigationId, '', 'ADMIN')).status).toBe(404);
        const sa = await list(investigationId, '', 'SUPERADMIN');
        expect(sa.status).toBe(200);
        expect(sa.body.data.count).toBe(1);

        expect((await listAdmin(investigationId, '', 'ADMIN')).status).toBe(404);
        expect((await listAdmin(investigationId, '', 'SUPERADMIN')).status).toBe(200);
    });

    it('002B with role USER answers 403', async () => {
        const investigationId = await createEvaluation();
        expect((await listAdmin(investigationId, '', 'USER')).status).toBe(403);
    });

    it('?limit=1&offset=1 returns the second row with the total count', async () => {
        const investigationId = await createEvaluation();
        await create({ investigationId, institutionName: 'Uno' });
        await create({ investigationId, institutionName: 'Dos' });
        await create({ investigationId, institutionName: 'Tres' });

        const res = await list(investigationId, '?limit=1&offset=1');
        expect(res.status).toBe(200);
        expect(res.body.data.count).toBe(3);
        expect(res.body.data.rows).toHaveLength(1);
        expect(res.body.data.rows[0].institutionName).toBe('Dos');
    });

    it('no query parameter other than limit, offset and lang changes the result', async () => {
        const investigationId = await createEvaluation();
        await create({ investigationId, institutionName: 'Uno' });
        await create({ investigationId, institutionName: 'Dos' });

        const plain = await list(investigationId);
        const noisy = await list(investigationId, '?healthFacilityId=x&search=Uno&type=HOSPITAL&sortOrder=2');
        expect(noisy.status).toBe(200);
        expect(noisy.body.data).toEqual(plain.body.data);
    });

    // ---- step 8: the 003 ----

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));

    it('003 returns the exact shape of §3.7, with the two masters nested', async () => {
        const investigationId = await createEvaluation();
        const type = await CatalogType.findOne({ where: { code: 'evaluationInstitutionType' } });
        const item = await CatalogItem.findOne({ where: { catalogTypeId: type!.getDataValue('catalogTypeId'), code: 'HOSPITAL' } });
        const facilityId = await createFacility();
        const created = await create({
            investigationId,
            healthFacilityId: facilityId,
            institutionName: 'MINSAL',
            personName: 'juan pérez',
            personContact: '555-1234',
            evaluationInstitutionTypeItemId: item!.getDataValue('catalogItemId'),
            notes: 'nota'
        });
        expect(created.status).toBe(201);

        const res = await getById(created.body.data.evaluationInstitutionId);
        expect(res.status).toBe(200);
        expect(Object.keys(res.body.data).sort()).toEqual([
            'appDetails', 'createdAt', 'deletedAt', 'evaluationInstitutionId',
            'evaluationInstitutionTypeItemId', 'healthFacility', 'healthFacilityId',
            'institutionName', 'institutionType', 'investigationId', 'isActive',
            'notes', 'personContact', 'personName', 'sortOrder', 'updatedAt'
        ]);
        expect(res.body.data.sysDetails).toBeUndefined();
        expect(Object.keys(res.body.data.healthFacility).sort()).toEqual(['healthFacilityId', 'isActive', 'localCode', 'name']);
        expect(Object.keys(res.body.data.institutionType).sort()).toEqual(['catalogItemId', 'code', 'name']);
        expect(res.body.data.personName).toBe('Juan Pérez');
        expect(res.body.data.personContact).toBe('555-1234');
    });

    it('003 on a free text institution returns both masters as null and 200', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'Hospital libre' });
        const res = await getById(created.body.data.evaluationInstitutionId);
        expect(res.status).toBe(200);
        expect(res.body.data.healthFacility).toBeNull();
        expect(res.body.data.institutionType).toBeNull();
        expect(res.body.data.personName).toBeNull();
        expect(res.body.data.personContact).toBeNull();
    });

    it('the three invisibility reasons are 404 for USER and ADMIN and 200 for SUPERADMIN, alone and combined', async () => {
        // 1. the institution itself is inactive
        const one = await createEvaluation();
        const a = await create({ investigationId: one, institutionName: 'A' });
        await EvaluationInstitution.update({ isActive: false }, { where: { evaluationInstitutionId: a.body.data.evaluationInstitutionId } });

        // 2. the clinical evaluation is sealed
        const two = await createEvaluation();
        const b = await create({ investigationId: two, institutionName: 'B' });
        await InvestigationClinicalEvaluation.update({ deletedAt: new Date() }, { where: { investigationId: two } });

        // 3. the investigation is inactive
        const three = await createEvaluation();
        const c = await create({ investigationId: three, institutionName: 'C' });
        await Investigation.update({ isActive: false }, { where: { investigationId: three } });

        // the three at once
        const four = await createEvaluation();
        const d = await create({ investigationId: four, institutionName: 'D' });
        await EvaluationInstitution.update({ isActive: false }, { where: { evaluationInstitutionId: d.body.data.evaluationInstitutionId } });
        await InvestigationClinicalEvaluation.update({ deletedAt: new Date() }, { where: { investigationId: four } });
        await Investigation.update({ isActive: false }, { where: { investigationId: four } });

        for (const [label, res] of [
            ['inactive institution', a], ['sealed evaluation', b],
            ['inactive investigation', c], ['all three', d]
        ] as [string, { body: { data: { evaluationInstitutionId: string } } }][]) {
            const id = res.body.data.evaluationInstitutionId;
            expect([label, (await getById(id, 'USER')).status]).toEqual([label, 404]);
            expect([label, (await getById(id, 'ADMIN')).status]).toEqual([label, 404]);
            const sa = await getById(id, 'SUPERADMIN');
            expect([label, sa.status]).toEqual([label, 200]);
        }
        expect((await getById(a.body.data.evaluationInstitutionId, 'USER')).body.code).toBe('EVALINST_003_NOT_FOUND');
    });

    it('003 on an unknown id is 404', async () => {
        const res = await getById('00000000-0000-4000-8000-000000000000');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('EVALINST_003_NOT_FOUND');
    });

    // ---- step 9: the 004, the differential update block of SPEC F12 ----

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const seedFull = async (): Promise<{ id: string, investigationId: string, facilityId: string, typeItemId: string }> => {
        const investigationId = await createEvaluation();
        const type = await CatalogType.findOne({ where: { code: 'evaluationInstitutionType' } });
        const item = await CatalogItem.findOne({ where: { catalogTypeId: type!.getDataValue('catalogTypeId'), code: 'HOSPITAL' } });
        const facilityId = await createFacility();
        const res = await create({
            investigationId,
            healthFacilityId: facilityId,
            institutionName: 'MINSAL',
            personName: 'juan pérez',
            personContact: '555-1234',
            evaluationInstitutionTypeItemId: item!.getDataValue('catalogItemId'),
            notes: 'nota'
        });
        expect(res.status).toBe(201);
        return {
            id: res.body.data.evaluationInstitutionId,
            investigationId,
            facilityId,
            typeItemId: item!.getDataValue('catalogItemId')
        };
    };

    // criterion 22 — a PUT resending the whole GET response writes nothing
    it('22 — a PUT of the GET response writes nothing', async () => {
        const { id } = await seedFull();
        await expectPutOfGetResponseWritesNothing({
            path: basePath,
            id,
            model: EvaluationInstitution,
            role: 'USER'
        });
    });

    // criterion 23 — an empty body behaves the same
    it('23 — a PUT with an empty body writes nothing', async () => {
        const { id } = await seedFull();
        const before = await EvaluationInstitution.findByPk(id);
        const versionBefore = (before!.getDataValue('sysDetails') as { version?: number })?.version;
        const updatedAtBefore = before!.getDataValue('updatedAt');
        const appDetailsBefore = (before!.getDataValue('appDetails') as unknown[]).length;

        const res = await update(id, {});
        expect(res.status).toBe(200);

        const after = await EvaluationInstitution.findByPk(id);
        expect((after!.getDataValue('sysDetails') as { version?: number })?.version).toBe(versionBefore);
        expect(after!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
        expect((after!.getDataValue('appDetails') as unknown[]).length).toBe(appDetailsBefore);
    });

    // criterion 24 — one changed field adds one appDetails entry and bumps the version by 1
    it('24 — one changed field appends to appDetails and bumps sysDetails.version by 1', async () => {
        const { id } = await seedFull();
        const before = await EvaluationInstitution.findByPk(id);
        const versionBefore = (before!.getDataValue('sysDetails') as { version?: number })?.version ?? 0;
        const appDetailsBefore = before!.getDataValue('appDetails') as { method: string }[];

        const res = await update(id, { notes: 'otra nota' });
        expect(res.status).toBe(200);
        expect(res.body.data.notes).toBe('otra nota');

        const after = await EvaluationInstitution.findByPk(id);
        expect((after!.getDataValue('sysDetails') as { version?: number })?.version).toBe(versionBefore + 1);
        const appDetailsAfter = after!.getDataValue('appDetails') as { method: string }[];
        expect(appDetailsAfter).toHaveLength(appDetailsBefore.length + 1);
        expect(appDetailsAfter[appDetailsAfter.length - 1].method).toBe('ESAVI-EVALINST-004');
        // the previous history is preserved whole
        expect(appDetailsAfter[0].method).toBe('ESAVI-EVALINST-001');
        expect(after!.getDataValue('updatedAt')).not.toBeNull();
    });

    // criterion 26 — inactive FKs are 404 even matching what is stored; a taken facility is 409
    it('26 — an inactive FK is 404 and a taken facility is 409, even with nothing else changing', async () => {
        const { id, facilityId } = await seedFull();

        // the very facility that is stored, deactivated behind the row's back
        await HealthFacility.update({ isActive: false }, { where: { healthFacilityId: facilityId } });
        const stale = await update(id, { healthFacilityId: facilityId });
        expect(stale.status).toBe(404);
        expect(stale.body.code).toBe('EVALINST_004_HEALTH_FACILITY_NOT_FOUND');
        await HealthFacility.update({ isActive: true }, { where: { healthFacilityId: facilityId } });

        // a catalogItem of another catalog
        const sexType = await CatalogType.findOne({ where: { code: 'sex' } });
        const sexItem = await CatalogItem.findOne({ where: { catalogTypeId: sexType!.getDataValue('catalogTypeId') } });
        const wrongType = await update(id, { evaluationInstitutionTypeItemId: sexItem!.getDataValue('catalogItemId') });
        expect(wrongType.status).toBe(404);
        expect(wrongType.body.code).toBe('EVALINST_004_INSTITUTION_TYPE_NOT_FOUND');

        // a facility another live sister of the same evaluation already holds
        const investigationId = (await EvaluationInstitution.findByPk(id))!.getDataValue('investigationId');
        const otherFacility = await createFacility();
        expect((await create({ investigationId, healthFacilityId: otherFacility })).status).toBe(201);
        const taken = await update(id, { healthFacilityId: otherFacility });
        expect(taken.status).toBe(409);
        expect(taken.body.code).toBe('EVALINST_004_ALREADY_EXISTS');
    });

    // criterion 27 — resending the stored personName leaves the ciphertext identical byte for byte
    it('27 — resending the stored personName leaves the ciphertext byte identical', async () => {
        const { id } = await seedFull();
        const before = await EvaluationInstitution.findByPk(id);
        const cipherNameBefore = before!.getDataValue('personName');
        const cipherContactBefore = before!.getDataValue('personContact');
        const versionBefore = (before!.getDataValue('sysDetails') as { version?: number })?.version;

        // exactly what the GET returned, in clear
        const res = await update(id, { personName: 'Juan Pérez', personContact: '555-1234' });
        expect(res.status).toBe(200);

        const after = await EvaluationInstitution.findByPk(id);
        expect(after!.getDataValue('personName')).toBe(cipherNameBefore);
        expect(after!.getDataValue('personContact')).toBe(cipherContactBefore);
        // and nothing was written at all
        expect((after!.getDataValue('sysDetails') as { version?: number })?.version).toBe(versionBefore);

        // a real change does re-encrypt
        const changed = await update(id, { personName: 'ana ruiz' });
        expect(changed.status).toBe(200);
        expect(changed.body.data.personName).toBe('Ana Ruiz');
        const afterChange = await EvaluationInstitution.findByPk(id);
        expect(afterChange!.getDataValue('personName')).toBe(esaviCrypt('Ana Ruiz'));
    });

    // criterion 28 — immutable fields are ignored in silence
    it('28 — investigationId and sortOrder are ignored in silence, with 200 and no change', async () => {
        const { id, investigationId } = await seedFull();
        const otherInvestigation = await createEvaluation();
        const before = await EvaluationInstitution.findByPk(id);
        const versionBefore = (before!.getDataValue('sysDetails') as { version?: number })?.version;

        const res = await update(id, { investigationId: otherInvestigation, sortOrder: 99 });
        expect(res.status).toBe(200);

        const after = await EvaluationInstitution.findByPk(id);
        expect(after!.getDataValue('investigationId')).toBe(investigationId);
        expect(after!.getDataValue('sortOrder')).toBe(before!.getDataValue('sortOrder'));
        expect((after!.getDataValue('sysDetails') as { version?: number })?.version).toBe(versionBefore);
    });

    // criterion 29 — the five nullable fields
    it('29 — the five nullable fields empty with an explicit null and "" empties institutionName', async () => {
        const { id } = await seedFull();
        const res = await update(id, {
            personName: null,
            personContact: null,
            evaluationInstitutionTypeItemId: null,
            notes: null
        });
        expect(res.status).toBe(200);
        expect(res.body.data.personName).toBeNull();
        expect(res.body.data.personContact).toBeNull();
        expect(res.body.data.evaluationInstitutionTypeItemId).toBeNull();
        expect(res.body.data.institutionType).toBeNull();
        expect(res.body.data.notes).toBeNull();
        // healthFacilityId, absent from the body, was left as it was
        expect(res.body.data.healthFacilityId).not.toBeNull();

        // "" empties the column to null, it does not store the empty string
        const empty = await update(id, { institutionName: '' });
        expect(empty.status).toBe(200);
        expect(empty.body.data.institutionName).toBeNull();
        expect((await EvaluationInstitution.findByPk(id))!.getDataValue('institutionName')).toBeNull();
    });

    // criterion 30 — the identification rule over the resulting state
    it('30 — the identification rule is evaluated over the resulting state', async () => {
        // a row with institutionName only
        const investigationId = await createEvaluation();
        const onlyName = await create({ investigationId, institutionName: 'Solo texto' });
        const blocked = await update(onlyName.body.data.evaluationInstitutionId, { institutionName: null });
        expect(blocked.status).toBe(400);
        expect(blocked.body.code).toBe('EVALINST_004_IDENTIFICATION_REQUIRED');

        // a row with both: emptying one is fine
        const { id } = await seedFull();
        const allowed = await update(id, { institutionName: null });
        expect(allowed.status).toBe(200);
        expect(allowed.body.data.institutionName).toBeNull();
        expect(allowed.body.data.healthFacilityId).not.toBeNull();

        // and now emptying the survivor is blocked
        const nowBlocked = await update(id, { healthFacilityId: null });
        expect(nowBlocked.status).toBe(400);
        expect(nowBlocked.body.code).toBe('EVALINST_004_IDENTIFICATION_REQUIRED');
    });

    // criterion 31 — an empty diff answers 200 with the row as it is
    it('31 — an empty diff answers 200 with the row, not 304 nor 204', async () => {
        const { id } = await seedFull();
        const res = await update(id, {});
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.data.evaluationInstitutionId).toBe(id);
    });

    it('004 on an unknown or invisible row is 404', async () => {
        expect((await update('00000000-0000-4000-8000-000000000000', { notes: 'x' })).status).toBe(404);

        const { id } = await seedFull();
        await EvaluationInstitution.update({ isActive: false }, { where: { evaluationInstitutionId: id } });
        const res = await update(id, { notes: 'x' }, 'USER');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('EVALINST_004_NOT_FOUND');
        expect((await update(id, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
    });
    // ---- step 10: the 005A ----

    const remove = (id: string, role: TestRole = 'ADMIN') =>
        request(app).delete(`${ basePath }/${ id }`).set(authHeader(role));

    it('32 — 005A seals isActive and deletedAt, and repeating is 409', async () => {
        const { id } = await seedFull();
        const res = await remove(id);
        expect(res.status).toBe(200);

        const row = await EvaluationInstitution.findByPk(id, { paranoid: false });
        expect(row!.getDataValue('isActive')).toBe(false);
        expect(row!.getDataValue('deletedAt')).not.toBeNull();

        const appDetails = row!.getDataValue('appDetails') as { method: string }[];
        expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-EVALINST-005A');

        const again = await remove(id);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('EVALINST_005A_ALREADY_INACTIVE');
    });

    it('32 — 005A does not check the state of the evaluation nor of the investigation', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'A' });
        await Investigation.update({ isActive: false }, { where: { investigationId } });

        const res = await remove(created.body.data.evaluationInstitutionId);
        expect(res.status).toBe(200);
    });

    it('005A frees the sortOrder for the next institution', async () => {
        const investigationId = await createEvaluation();
        const first = await create({ investigationId, institutionName: 'Uno' });
        const second = await create({ investigationId, institutionName: 'Dos' });
        expect([first.body.data.sortOrder, second.body.data.sortOrder]).toEqual([1, 2]);

        expect((await remove(second.body.data.evaluationInstitutionId)).status).toBe(200);

        // the seal took the 2 out of the partial index and out of the MAX the trigger computes
        const third = await create({ investigationId, institutionName: 'Tres' });
        expect(third.status).toBe(201);
        expect(third.body.data.sortOrder).toBe(2);
    });

    it('005A on an unknown id is 404, and a USER gets 403', async () => {
        expect((await remove('00000000-0000-4000-8000-000000000000')).status).toBe(404);
        const { id } = await seedFull();
        expect((await remove(id, 'USER')).status).toBe(403);
    });
    // ---- step 11: the 005B, with the sortOrder collision ----

    const activate = (id: string, role: TestRole = 'ADMIN') =>
        request(app).patch(`${ basePath }/activate/${ id }`).set(authHeader(role));

    it('33 — the sortOrder collision scenario, whole', async () => {
        const investigationId = await createEvaluation();
        const one = await create({ investigationId, institutionName: 'Uno' });
        const two = await create({ investigationId, institutionName: 'Dos' });
        expect([one.body.data.sortOrder, two.body.data.sortOrder]).toEqual([1, 2]);

        // retire the 2 — the seal frees its number from the partial index
        expect((await remove(two.body.data.evaluationInstitutionId)).status).toBe(200);

        // the new one takes MAX(1) + 1 = 2 and now collides with the retired one
        const three = await create({ investigationId, institutionName: 'Tres' });
        expect(three.body.data.sortOrder).toBe(2);

        // reactivating the retired one must be a 200 and leave it at 3
        const res = await activate(two.body.data.evaluationInstitutionId);
        expect(res.status).toBe(200);

        const revived = await EvaluationInstitution.findByPk(two.body.data.evaluationInstitutionId, { paranoid: false });
        expect(revived!.getDataValue('sortOrder')).toBe(3);
        expect(revived!.getDataValue('isActive')).toBe(true);
        expect(revived!.getDataValue('deletedAt')).toBeNull();

        // and no two of the three live rows share a number
        const live = await EvaluationInstitution.findAll({ where: { investigationId, deletedAt: null } });
        const numbers = live.map(r => r.getDataValue('sortOrder')).sort();
        expect(numbers).toEqual([1, 2, 3]);
    });

    it('34 — without collision the 005B keeps the original sortOrder', async () => {
        const investigationId = await createEvaluation();
        const one = await create({ investigationId, institutionName: 'Uno' });
        const two = await create({ investigationId, institutionName: 'Dos' });
        expect((await remove(two.body.data.evaluationInstitutionId)).status).toBe(200);

        const res = await activate(two.body.data.evaluationInstitutionId);
        expect(res.status).toBe(200);
        const row = await EvaluationInstitution.findByPk(two.body.data.evaluationInstitutionId);
        expect(row!.getDataValue('sortOrder')).toBe(2);
        expect(one.body.data.sortOrder).toBe(1);

        const appDetails = row!.getDataValue('appDetails') as { method: string }[];
        expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-EVALINST-005B');
    });

    it('a row whose sortOrder is null reactivates without entering the collision step', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'Nula' });
        const id = created.body.data.evaluationInstitutionId;
        expect((await remove(id)).status).toBe(200);

        // the partial index excludes the nulls, so this row cannot collide with anything
        await EvaluationInstitution.update({ sortOrder: null }, { where: { evaluationInstitutionId: id } });

        const res = await activate(id);
        expect(res.status).toBe(200);
        const row = await EvaluationInstitution.findByPk(id);
        expect(row!.getDataValue('sortOrder')).toBeNull();
        expect(row!.getDataValue('isActive')).toBe(true);
    });

    it('34 — reactivating an already active row is 409, and the minimum role is ADMIN', async () => {
        const { id } = await seedFull();
        const already = await activate(id);
        expect(already.status).toBe(409);
        expect(already.body.code).toBe('EVALINST_005B_ALREADY_ACTIVE');

        expect((await activate(id, 'USER')).status).toBe(403);
        expect((await activate('00000000-0000-4000-8000-000000000000')).status).toBe(404);
    });

    it('35 — the 005B revalidates neither the duplicate guard nor the two masters', async () => {
        const investigationId = await createEvaluation();
        const facilityId = await createFacility();
        const first = await create({ investigationId, healthFacilityId: facilityId });
        const firstId = first.body.data.evaluationInstitutionId;
        expect((await remove(firstId)).status).toBe(200);

        // the same facility is loaded again while the first one is retired
        const second = await create({ investigationId, healthFacilityId: facilityId });
        expect(second.status).toBe(201);

        // and the facility is retired behind everybody's back
        await HealthFacility.update({ isActive: false }, { where: { healthFacilityId: facilityId } });

        // reactivating is still a 200: two live rows now share the facility, which §6 declares assumed
        const res = await activate(firstId);
        expect(res.status).toBe(200);

        const live = await EvaluationInstitution.findAll({ where: { investigationId, healthFacilityId: facilityId, isActive: true } });
        expect(live).toHaveLength(2);
        await HealthFacility.update({ isActive: true }, { where: { healthFacilityId: facilityId } });
    });

    it('35 — the 005B does not check the state of the parents either', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'A' });
        const id = created.body.data.evaluationInstitutionId;
        expect((await remove(id)).status).toBe(200);

        await Investigation.update({ isActive: false }, { where: { investigationId } });
        expect((await activate(id)).status).toBe(200);
    });
    // ---- step 12: the 005C ----

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    it('36 — purging an active institution is 409, purging a retired one destroys it', async () => {
        const { id, facilityId, typeItemId } = await seedFull();

        const active = await purge(id);
        expect(active.status).toBe(409);
        expect(active.body.code).toBe('EVALINST_005C_STILL_ACTIVE');

        expect((await remove(id)).status).toBe(200);

        const res = await purge(id);
        expect(res.status).toBe(200);
        expect(await EvaluationInstitution.findByPk(id, { paranoid: false })).toBeNull();

        // a later 003 is a 404
        expect((await getById(id, 'SUPERADMIN')).status).toBe(404);

        // the two masters it cited are still there
        expect(await HealthFacility.findByPk(facilityId)).not.toBeNull();
        expect(await CatalogItem.findByPk(typeItemId)).not.toBeNull();
    });

    it('36 — the minimum role of the 005C is SUPERADMIN', async () => {
        const { id } = await seedFull();
        expect((await remove(id)).status).toBe(200);
        expect((await purge(id, 'ADMIN')).status).toBe(403);
        expect((await purge(id, 'USER')).status).toBe(403);
        expect((await purge(id)).status).toBe(200);
    });

    it('005C on an unknown id is 404', async () => {
        const res = await purge('00000000-0000-4000-8000-000000000000');
        expect(res.status).toBe(404);
        expect(res.body.code).toBe('EVALINST_005C_NOT_FOUND');
    });
    // ---- step 13: the dump of ESAVI-INVCLIEV-005C ----

    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

    const readLogSince = (offset: number): string =>
        fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(offset) : '';

    const logOffset = (): number =>
        fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

    // log4js flushes asynchronously, so the line is not on disk the instant the response returns
    const flushLog = () => new Promise(resolve => setTimeout(resolve, 250));

    const purgeEvaluation = (investigationId: string) =>
        request(app).delete(`/api/investigation-clinical-evaluations/purge/${ investigationId }`).set(authHeader('SUPERADMIN'));

    it('37 — purging an evaluation with three institutions writes one warn line with the count 3', async () => {
        const investigationId = await createEvaluation();
        const a = await create({ investigationId, institutionName: 'Uno', personName: 'juan pérez', personContact: '555-1234' });
        await create({ investigationId, institutionName: 'Dos' });
        const c = await create({ investigationId, institutionName: 'Tres' });
        // one of the three is sealed: the cascade takes it all the same
        expect((await remove(c.body.data.evaluationInstitutionId)).status).toBe(200);

        // the parent has to be sealed before it can be purged
        await InvestigationClinicalEvaluation.update({ deletedAt: new Date() }, { where: { investigationId } });

        const offset = logOffset();
        const res = await purgeEvaluation(investigationId);
        expect(res.status).toBe(200);

        await flushLog();
        const written = readLogSince(offset);
        const lines = written.split(/\r?\n/).filter(l => l.includes('evaluation institution(s) dragged by ON DELETE CASCADE'));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('ESAVI-INVCLIEV-005C: 3 evaluation institution(s) dragged by ON DELETE CASCADE, purged by');

        // the line carries no ciphertext and no person datum at all
        expect(lines[0]).not.toContain(esaviCrypt('Juan Pérez'));
        expect(lines[0]).not.toContain('Juan Pérez');
        expect(lines[0]).not.toContain('555-1234');
        expect(lines[0]).not.toContain('personName');
        expect(lines[0]).not.toContain('personContact');

        // the cascade really destroyed them, and the purge was not blocked
        expect(await EvaluationInstitution.count({ where: { investigationId }, paranoid: false })).toBe(0);
        expect(await EvaluationInstitution.findByPk(a.body.data.evaluationInstitutionId, { paranoid: false })).toBeNull();
    });

    it('37 — with zero institutions no line is written and the purge still succeeds', async () => {
        const investigationId = await createEvaluation();
        await InvestigationClinicalEvaluation.update({ deletedAt: new Date() }, { where: { investigationId } });

        const offset = logOffset();
        expect((await purgeEvaluation(investigationId)).status).toBe(200);

        await flushLog();
        const written = readLogSince(offset);
        expect(written).not.toContain('evaluation institution(s) dragged by ON DELETE CASCADE');
    });
    // ---- step 14: the seventh line of ESAVI-INVESTGN-005C ----

    const purgeInvestigation = (investigationId: string) =>
        request(app).delete(`/api/investigations/purge/${ investigationId }`).set(authHeader('SUPERADMIN'));

    it('38 — purging the investigation writes the institutions line last, with the two hop wording', async () => {
        const investigationId = await createEvaluation();
        await create({ investigationId, institutionName: 'Uno', personName: 'juan pérez', personContact: '555-1234' });
        const two = await create({ investigationId, institutionName: 'Dos' });
        expect((await remove(two.body.data.evaluationInstitutionId)).status).toBe(200);

        await Investigation.update({ isActive: false, deletedAt: new Date() }, { where: { investigationId } });

        const offset = logOffset();
        const res = await purgeInvestigation(investigationId);
        expect(res.status).toBe(200);

        await flushLog();
        const added = readLogSince(offset);
        const dumpLines = added.split(/\r?\n/).filter(l => l.includes('ESAVI-INVESTGN-005C') && l.includes('dragged by ON DELETE CASCADE'));

        const institutionLines = dumpLines.filter(l => l.includes('evaluation institution(s)'));
        expect(institutionLines).toHaveLength(1);
        expect(institutionLines[0]).toContain('2 evaluation institution(s) dragged by ON DELETE CASCADE in two hops, purged by');

        // it is the LAST of the dump lines
        expect(dumpLines[dumpLines.length - 1]).toBe(institutionLines[0]);

        // the clinical evaluation line is there too, and the institutions line comes after it
        const evaluationLine = dumpLines.findIndex(l => l.includes('clinical evaluation'));
        expect(evaluationLine).toBeGreaterThanOrEqual(0);
        expect(dumpLines.indexOf(institutionLines[0])).toBeGreaterThan(evaluationLine);

        // no ciphertext and no person datum
        expect(institutionLines[0]).not.toContain(esaviCrypt('Juan Pérez'));
        expect(institutionLines[0]).not.toContain('Juan Pérez');
        expect(institutionLines[0]).not.toContain('555-1234');

        // the cascade really destroyed them
        expect(await EvaluationInstitution.count({ where: { investigationId }, paranoid: false })).toBe(0);
    });

    it('38 — purging an investigation with no clinical evaluation writes neither of the two lines', async () => {
        const patient = await Patient.create({
            firstName: esaviCrypt('P'), lastName: esaviCrypt(`Bare ${ suffix }`),
            documentNumber: esaviCrypt(`BR${ suffix }`), healthSystemCode: `BR${ suffix }`, birthDate: '2000-01-01'
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'), healthFacilityId: await createFacility(),
            caseCode: `BR-${ suffix }`, reportDate: new Date().toISOString().slice(0, 10), eventDate: '2024-01-01'
        });
        const investigationId = (await Investigation.create({
            caseId: esaviCase.getDataValue('caseId'), statusItemId: statusZeroItemId,
            isActive: false, deletedAt: new Date()
        })).getDataValue('investigationId');

        const offset = logOffset();
        expect((await purgeInvestigation(investigationId)).status).toBe(200);

        await flushLog();
        const added = readLogSince(offset);
        expect(added).not.toContain('evaluation institution(s) dragged');
        expect(added).not.toContain('clinical evaluation dragged');
    });
    // ---- step 15: routing precedence and mounting ----

    it('the literal paths reach their own operation and never the /:id one', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'Ruta' });
        const id = created.body.data.evaluationInstitutionId;

        // /admin/investigation/:id reaches the 002B and not the 003: it answers { count, rows }
        const admin = await listAdmin(investigationId);
        expect(admin.status).toBe(200);
        expect(admin.body.data).toHaveProperty('count');
        expect(admin.body.data).toHaveProperty('rows');

        // /investigation/:id reaches the 002A, also a listing
        const plain = await list(investigationId);
        expect(plain.status).toBe(200);
        expect(plain.body.data).toHaveProperty('count');

        // /:id reaches the 003, a single row
        const one = await getById(id);
        expect(one.status).toBe(200);
        expect(one.body.data.evaluationInstitutionId).toBe(id);
        expect(one.body.data).not.toHaveProperty('rows');

        // PATCH /activate/:id reaches the 005B — it answers 409 on an active row, which only that
        // operation does
        const act = await activate(id);
        expect(act.status).toBe(409);
        expect(act.body.code).toBe('EVALINST_005B_ALREADY_ACTIVE');

        // DELETE /purge/:id reaches the 005C — 409 STILL_ACTIVE, which only that operation answers
        const prg = await purge(id);
        expect(prg.status).toBe(409);
        expect(prg.body.code).toBe('EVALINST_005C_STILL_ACTIVE');

        // DELETE /:id reaches the 005A
        expect((await remove(id)).status).toBe(200);
    });

    it('no literal path falls into the UUID validator of the /:id', async () => {
        // if /admin/investigation/:id were captured by /:id, "admin" would be a 400 from the UUID
        // validator instead of the 404 of a well formed but unknown investigation
        const unknown = '00000000-0000-4000-8000-000000000000';
        expect((await listAdmin(unknown)).status).toBe(404);
        expect((await list(unknown)).status).toBe(404);
        expect((await activate(unknown)).status).toBe(404);
        expect((await purge(unknown)).status).toBe(404);

        // and a genuinely malformed :id is the 400 it should be
        const bad = await request(app).get(`${ basePath }/not-a-uuid`).set(authHeader('USER'));
        expect(bad.status).toBe(400);
    });

    it('the router is mounted under /api/evaluation-institutions and nowhere else', async () => {
        const investigationId = await createEvaluation();
        const ok = await create({ investigationId, institutionName: 'Montaje' });
        expect(ok.status).toBe(201);

        const wrong = await request(app).get('/api/evaluation-institution').set(authHeader('USER'));
        expect(wrong.status).toBe(404);
    });

    it('every one of the eight routes enforces its minimum role', async () => {
        const investigationId = await createEvaluation();
        const created = await create({ investigationId, institutionName: 'Roles' });
        const id = created.body.data.evaluationInstitutionId;

        // ANALYTICS is below USER, so it is rejected everywhere
        expect((await create({ investigationId, institutionName: 'X' }, 'ANALYTICS')).status).toBe(403);
        expect((await list(investigationId, '', 'ANALYTICS')).status).toBe(403);
        expect((await getById(id, 'ANALYTICS')).status).toBe(403);

        // 002B, 005A and 005B need ADMIN
        expect((await listAdmin(investigationId, '', 'USER')).status).toBe(403);
        expect((await remove(id, 'USER')).status).toBe(403);
        expect((await activate(id, 'USER')).status).toBe(403);

        // 005C needs SUPERADMIN
        expect((await purge(id, 'ADMIN')).status).toBe(403);
    });
});
