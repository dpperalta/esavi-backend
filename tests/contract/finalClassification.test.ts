import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, FinalClassification, HealthFacility, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine finalClassification operations of SPEC F41. It walks the entity
 * end to end and covers what cannot be checked by hand reliably:
 *
 *  - the polarity of `dIsUnclassifiable`, which CLOSES the other ten columns instead of opening
 *    a block — the inverse of every conditional flag from F34 to F40. An implementation that
 *    reads it by analogy inverts the condition and every happy case still passes,
 *  - `false` counted as a value and never as an absence, in the three places it matters:
 *    the prohibition of 001, the prohibition of 004 and the diff,
 *  - the precedence rule evaluated over the RESULTING state and not over the body, which is the
 *    only way a PUT sending a single importance slot collides with what was already stored,
 *  - the order of evaluation: the prohibition of D runs before the precedence rule, and both
 *    before the catalog lookup. Two cases fail only if that order is inverted,
 *  - the one to one relation whose slot is not released by the soft delete.
 */
describe('finalClassification contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // The three seeded precedence items, an item of a different catalogType and a deactivated
    // one of the right type: the three shapes the catalog check has to tell apart
    let importanceOneId: string;
    let importanceTwoId: string;
    let importanceThreeId: string;
    let wrongCatalogItemId: string;
    let inactiveImportanceId: string;
    let inactiveCaseId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors on
    // purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // Every case is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async ( options: { isActive?: boolean } = {} ): Promise<string> => {
        const { isActive = true } = options;
        caseCounter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`FinalClassification ${ caseCounter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`FC${ caseCounter }${ suffix }`),
            healthSystemCode: `FC${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `FC${ caseCounter }${ suffix }`,
            name: `Final Classification ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `FC-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // The catalogType coded 'finalClassificationImportance' is a precondition of SPEC F41 and is
    // not seeded by esaviapp.sql, so the suite creates it once with its three items of code and
    // value 1, 2 and 3, plus a deactivated fourth one
    const seedImportanceCatalog = async (): Promise<void> => {
        const importanceType = await CatalogType.findOne({ where: { code: 'finalClassificationImportance' } })
            ?? await CatalogType.create({ code: 'finalClassificationImportance', name: 'Final Classification Importance' });
        const catalogTypeId = importanceType.getDataValue('catalogTypeId');

        const items: Record<string, string> = {};
        for( const code of ['1', '2', '3'] ) {
            const item = await CatalogItem.findOne({ where: { catalogTypeId, code } })
                ?? await CatalogItem.create({ catalogTypeId, code, name: `Importance ${ code }`, value: code });
            items[code] = item.getDataValue('catalogItemId');
        }
        importanceOneId = items['1'];
        importanceTwoId = items['2'];
        importanceThreeId = items['3'];

        const inactive = await CatalogItem.findOne({ where: { catalogTypeId, code: `OFF${ suffix }` } })
            ?? await CatalogItem.create({
                catalogTypeId,
                code: `OFF${ suffix }`,
                name: `Retired ${ suffix }`,
                value: '9',
                isActive: false
            });
        inactiveImportanceId = inactive.getDataValue('catalogItemId');
    };

    const create = ( payload: Record<string, unknown> = {}, role: TestRole = 'USER' ) =>
        request(app).post('/api/final-classifications').set(authHeader(role)).send(payload);

    const get = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/final-classifications/${ id }`).set(authHeader(role));

    const getByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/final-classifications/case/${ caseId }`).set(authHeader(role));

    const list = ( query: string = '', role: TestRole = 'USER' ) =>
        request(app).get(`/api/final-classifications${ query }`).set(authHeader(role));

    const listAdmin = ( query: string = '', role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/final-classifications/admin${ query }`).set(authHeader(role));

    const update = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/final-classifications/${ id }`).set(authHeader(role)).send(payload);

    const remove = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/final-classifications/${ id }`).set(authHeader(role));

    const activate = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/final-classifications/activate/${ id }`).set(authHeader(role));

    const purge = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/final-classifications/purge/${ id }`).set(authHeader(role));

    // A final classification over a brand new case, which is the only way to get one
    const classifyNewCase = async ( payload: Record<string, unknown> = {} ): Promise<{ id: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await create({ caseId, ...payload });
        expect(created.status).toBe(201);
        return { id: created.body.data.finalClassificationId, caseId };
    };

    const rowOf = async ( id: string ) => ( await FinalClassification.findByPk(id) )!;

    const versionOf = async ( id: string ): Promise<number | undefined> => {
        const row = await rowOf(id);
        return ( row.getDataValue('sysDetails') as { version?: number } | null )?.version;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        await seedImportanceCatalog();

        inactiveCaseId = await createCaseFixture({ isActive: false });

        // An item of a different catalogType, to prove the check looks at the type and not only
        // at the existence of the item
        const sexType = await CatalogType.findOne({ where: { code: 'sex' } });
        const sexItem = await CatalogItem.findOne({
            where: { catalogTypeId: sexType!.getDataValue('catalogTypeId') }
        });
        wrongCatalogItemId = sexItem!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('ESAVI-FINCLASS-001 — create', () => {

        it('creates the empty verdict and answers 201 with the twelve data columns null', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId });
            const data = response.body.data;

            expect(response.status).toBe(201);
            expect(data.finalClassificationId).toBeDefined();
            expect(data.importanceA).toBeNull();
            expect(data.importanceB).toBeNull();
            expect(data.importanceC).toBeNull();
            expect(data.aIsRelatedToVaccineProduct).toBeNull();
            expect(data.aIsRelatedToQualityDeviation).toBeNull();
            expect(data.aIsRelatedToProgrammaticError).toBeNull();
            expect(data.aIsRelatedToStress).toBeNull();
            expect(data.bIsConsistentTemporalRelation).toBeNull();
            expect(data.bHasDeterminantFactor).toBeNull();
            expect(data.cHasCoincidentCause).toBeNull();
            expect(data.dIsUnclassifiable).toBeNull();
            expect(data.notes).toBeNull();
            expect(data.isActive).toBe(true);
            expect(data.case).toEqual(expect.objectContaining({ caseId, isActive: true }));
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-FINCLASS-001');
        });

        it('creates over a case with no classification, no notification and no investigation', async () => {
            // The fixture case has none of the three: the only precondition is the case itself
            const caseId = await createCaseFixture();

            expect((await create({ caseId })).status).toBe(201);
        });

        it('resolves the three importances and trims notes', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId,
                importanceCItemId: importanceThreeId,
                notes: '   Ranked   '
            });
            const data = response.body.data;

            expect(response.status).toBe(201);
            expect(data.importanceA).toEqual(expect.objectContaining({ code: '1', value: '1' }));
            expect(data.importanceB).toEqual(expect.objectContaining({ code: '2' }));
            expect(data.importanceC).toEqual(expect.objectContaining({ code: '3' }));
            expect(data.notes).toBe('Ranked');
        });

        it('never exposes sysDetails nor the four raw foreign keys', async () => {
            const { id } = await classifyNewCase({ importanceAItemId: importanceOneId });

            const response = await get(id);

            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.caseId).toBeUndefined();
            expect(response.body.data.importanceAItemId).toBeUndefined();
            expect(response.body.data.importanceBItemId).toBeUndefined();
            expect(response.body.data.importanceCItemId).toBeUndefined();
        });

        it('answers 404 over an inactive case and over a case that does not exist', async () => {
            const inactive = await create({ caseId: inactiveCaseId });
            const missing = await create({ caseId: unknownUuid });

            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('FINCLASS_001_CASE_NOT_FOUND');
            expect(missing.status).toBe(404);
        });

        it('answers 409 on the second final classification of the case, naming the caseId', async () => {
            const { caseId } = await classifyNewCase();

            const response = await create({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED');
            expect(response.body.message).toContain(caseId);
        });

        it('keeps answering 409 when the existing final classification is inactive', async () => {
            const { id, caseId } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);

            // The UNIQUE of the DDL does not filter by isActive either: the slot is still taken
            const response = await create({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('FINCLASS_001_CASE_ALREADY_FINAL_CLASSIFIED');
        });

    });

    describe('ESAVI-FINCLASS-001 — block D closes the other ten columns', () => {

        it('accepts the flag on its own', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, dIsUnclassifiable: true });

            expect(response.status).toBe(201);
            expect(response.body.data.dIsUnclassifiable).toBe(true);
        });

        it('accepts notes alongside the flag: notes is outside the block', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                notes: 'sin datos suficientes'
            });

            expect(response.status).toBe(201);
            expect(response.body.data.notes).toBe('sin datos suficientes');
        });

        it('rejects any of the seven booleans sent with the flag', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                cHasCoincidentCause: true
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('rejects a boolean sent as FALSE with the flag: false is a value, not an absence', async () => {
            const caseId = await createCaseFixture();

            // The single case that fails if somebody writes `if( data.aIsRelatedToStress )` out
            // of habit: that false states block A was evaluated and ruled out, and D states
            // nothing could be evaluated at all
            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                aIsRelatedToStress: false
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('rejects any of the three importances sent with the flag', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                importanceAItemId: importanceOneId
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('leaves the ten columns free when the flag is false or absent: only true closes', async () => {
            const withFalseFlag = await create({
                caseId: await createCaseFixture(),
                dIsUnclassifiable: false,
                cHasCoincidentCause: true
            });
            const withNoFlag = await create({
                caseId: await createCaseFixture(),
                cHasCoincidentCause: true
            });

            expect(withFalseFlag.status).toBe(201);
            expect(withNoFlag.status).toBe(201);
        });

    });

    describe('ESAVI-FINCLASS-001 — precedence between the two rules', () => {

        // The two cases that fail ONLY if the order of evaluation is inverted. Every other case
        // of the block passes either way
        it('answers with the prohibition and never with the duplication', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceOneId
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('answers with the prohibition and never with the catalog 404', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                dIsUnclassifiable: true,
                importanceAItemId: wrongCatalogItemId
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

    });

    describe('ESAVI-FINCLASS-001 — the precedence rule', () => {

        it('rejects two importances holding the same catalogItem', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceOneId
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_001_IMPORTANCE_DUPLICATED');
        });

        it('accepts the three of them holding different catalogItems', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId,
                importanceCItemId: importanceThreeId
            });

            expect(response.status).toBe(201);
        });

        it('accepts a partial ranking: the nulls do not take part', async () => {
            const caseId = await createCaseFixture();

            const response = await create({
                caseId,
                importanceAItemId: importanceOneId,
                importanceCItemId: importanceThreeId
            });

            expect(response.status).toBe(201);
            expect(response.body.data.importanceB).toBeNull();
        });

    });

    describe('ESAVI-FINCLASS-001 — the three catalog foreign keys', () => {

        it('answers 404 naming the block when the item belongs to another catalogType', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, importanceBItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('FINCLASS_001_IMPORTANCE_NOT_FOUND');
            expect(response.body.message).toContain('B');
        });

        it('answers 404 when the item of the right type is inactive', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, importanceCItemId: inactiveImportanceId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('FINCLASS_001_IMPORTANCE_NOT_FOUND');
            expect(response.body.message).toContain('C');
        });

        it('answers 404 when the item does not exist at all', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, importanceAItemId: unknownUuid });

            expect(response.status).toBe(404);
            expect(response.body.message).toContain('A');
        });

    });

    describe('ESAVI-FINCLASS-001 — shape validations', () => {

        it('rejects an importance that is not a UUID', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, importanceAItemId: 'no-es-uuid' });

            expect(response.status).toBe(400);
        });

        it('rejects a flag that is not a boolean', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, dIsUnclassifiable: 'sí' });

            expect(response.status).toBe(400);
        });

        it('accepts notes of 5000 characters: the only text column has no ceiling', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, notes: 'x'.repeat(5000) });

            expect(response.status).toBe(201);
            expect(response.body.data.notes).toHaveLength(5000);
        });

        it('rejects a create with no caseId', async () => {
            expect((await create({})).status).toBe(400);
        });

    });

    describe('ESAVI-FINCLASS-001 — the tri-state of the eight booleans', () => {

        it('stores false as false and an omitted boolean as null', async () => {
            const caseId = await createCaseFixture();

            const response = await create({ caseId, cHasCoincidentCause: false });
            const data = response.body.data;

            expect(data.cHasCoincidentCause).toBe(false);
            expect(data.bHasDeterminantFactor).toBeNull();
        });

    });

    describe('ESAVI-FINCLASS-002A and 002B — the dual listing', () => {

        it('hides the inactive rows from the public listing and shows them to the admin one', async () => {
            const { id, caseId } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);

            const publicList = await list(`?caseId=${ caseId }`);
            const adminList = await listAdmin(`?caseId=${ caseId }`);

            expect(publicList.body.data.count).toBe(0);
            expect(adminList.body.data.count).toBe(1);
            expect(adminList.body.data.rows[0].isActive).toBe(false);
        });

        it('answers 403 to a USER on the admin listing', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });

        it('answers 200 with an empty page when the caseId filter matches nothing', async () => {
            const response = await list(`?caseId=${ unknownUuid }`);

            expect(response.status).toBe(200);
            expect(response.body.data).toEqual(expect.objectContaining({ count: 0, rows: [] }));
        });

        it('keeps a row whose importanceB and importanceC are null: the includes are optional', async () => {
            const { caseId } = await classifyNewCase({ importanceAItemId: importanceOneId });

            const response = await list(`?caseId=${ caseId }`);
            const row = response.body.data.rows[0];

            expect(response.body.data.count).toBe(1);
            expect(row.importanceA).toEqual(expect.objectContaining({ code: '1' }));
            expect(row.importanceB).toBeNull();
            expect(row.importanceC).toBeNull();
        });

        it('returns every row in the full shape, with no sysDetails and no raw foreign keys', async () => {
            const { caseId } = await classifyNewCase({ notes: 'listed' });

            const row = ( await list(`?caseId=${ caseId }`) ).body.data.rows[0];

            expect(row.case).toEqual(expect.objectContaining({ caseId }));
            expect(row.notes).toBe('listed');
            expect(row.isActive).toBe(true);
            expect(row.sysDetails).toBeUndefined();
            expect(row.caseId).toBeUndefined();
            expect(row.importanceAItemId).toBeUndefined();
        });

    });

    describe('ESAVI-FINCLASS-003 — get by id', () => {

        it('answers 404 for an id that does not exist', async () => {
            const response = await get(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('FINCLASS_003_NOT_FOUND');
        });

        it('hides an inactive row from USER and ADMIN and shows it to SUPERADMIN', async () => {
            const { id } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);

            expect((await get(id, 'USER')).status).toBe(404);
            expect((await get(id, 'ADMIN')).status).toBe(404);
            expect((await get(id, 'SUPERADMIN')).status).toBe(200);
        });

        it('returns the four foreign keys resolved and none of them raw', async () => {
            const { id, caseId } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId
            });

            const data = ( await get(id) ).body.data;

            expect(data.case).toEqual(expect.objectContaining({ caseId, isActive: true }));
            expect(data.importanceA).toEqual(expect.objectContaining({ code: '1', name: 'Importance 1' }));
            expect(data.importanceB).toEqual(expect.objectContaining({ code: '2' }));
            expect(data.importanceC).toBeNull();
            expect(data.caseId).toBeUndefined();
            expect(data.importanceAItemId).toBeUndefined();
            expect(data.sysDetails).toBeUndefined();
        });

    });

    describe('ESAVI-FINCLASS-006 — get by case', () => {

        it('returns the object itself and not { count, rows }', async () => {
            const { id, caseId } = await classifyNewCase();

            const response = await getByCase(caseId);

            expect(response.status).toBe(200);
            expect(response.body.data.finalClassificationId).toBe(id);
            expect(response.body.data.count).toBeUndefined();
            expect(response.body.data.rows).toBeUndefined();
        });

        it('tells a broken case link from a pending verdict with two different codes', async () => {
            const caseWithNoVerdict = await createCaseFixture();

            const brokenLink = await getByCase(unknownUuid);
            const pending = await getByCase(caseWithNoVerdict);

            expect(brokenLink.status).toBe(404);
            expect(brokenLink.body.code).toBe('FINCLASS_006_CASE_NOT_FOUND');
            expect(pending.status).toBe(404);
            expect(pending.body.code).toBe('FINCLASS_006_NOT_FOUND');
        });

        it('hides an inactive row from USER and shows it to SUPERADMIN', async () => {
            const { id, caseId } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);

            expect((await getByCase(caseId, 'USER')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

    });

    describe('ESAVI-FINCLASS-004 — update', () => {

        it('answers 404 for an id that does not exist', async () => {
            const response = await update(unknownUuid, { notes: 'x' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('FINCLASS_004_NOT_FOUND');
        });

        it('writes a single field and appends exactly one appDetails entry', async () => {
            const { id } = await classifyNewCase();
            const versionBefore = await versionOf(id);

            const response = await update(id, { notes: 'un veredicto' });

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('un veredicto');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.appDetails[1].method).toBe('ESAVI-FINCLASS-004');
            expect(await versionOf(id)).toBe(( versionBefore ?? 0 ) + 1);
        });

        it('stores false as false and never as null', async () => {
            const { id } = await classifyNewCase();

            const response = await update(id, { aIsRelatedToStress: false });

            expect(response.body.data.aIsRelatedToStress).toBe(false);
        });

        it('erases a stored value when the key arrives null', async () => {
            const { id } = await classifyNewCase({ cHasCoincidentCause: false });

            const response = await update(id, { cHasCoincidentCause: null });

            expect(response.status).toBe(200);
            expect(response.body.data.cHasCoincidentCause).toBeNull();
        });

        it('ignores caseId in silence, with no 400 and with no write', async () => {
            const { id } = await classifyNewCase();
            const otherCaseId = await createCaseFixture();
            const versionBefore = await versionOf(id);

            const response = await update(id, { caseId: otherCaseId });

            expect(response.status).toBe(200);
            expect(response.body.data.case.caseId).not.toBe(otherCaseId);
            expect(await versionOf(id)).toBe(versionBefore);
        });

    });

    describe('ESAVI-FINCLASS-004 — the asymmetry of block D', () => {

        it('forces the ten columns to null when the flag is raised, with no error', async () => {
            const { id } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId,
                aIsRelatedToStress: true
            });

            const response = await update(id, { dIsUnclassifiable: true });
            const data = response.body.data;

            expect(response.status).toBe(200);
            expect(data.dIsUnclassifiable).toBe(true);
            expect(data.importanceA).toBeNull();
            expect(data.importanceB).toBeNull();
            expect(data.importanceC).toBeNull();
            expect(data.aIsRelatedToStress).toBeNull();
            expect(data.aIsRelatedToVaccineProduct).toBeNull();
            expect(data.cHasCoincidentCause).toBeNull();
        });

        it('rejects a forbidden field that travels WITH a value', async () => {
            const { id } = await classifyNewCase();

            const response = await update(id, { dIsUnclassifiable: true, cHasCoincidentCause: true });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_004_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('accepts a forbidden field that travels explicitly null', async () => {
            const { id } = await classifyNewCase();

            const response = await update(id, { dIsUnclassifiable: true, cHasCoincidentCause: null });

            expect(response.status).toBe(200);
        });

        it('rejects a forbidden boolean that travels as false', async () => {
            const { id } = await classifyNewCase();

            const response = await update(id, { dIsUnclassifiable: true, bHasDeterminantFactor: false });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_004_UNCLASSIFIABLE_FIELDS_NOT_ALLOWED');
        });

        it('keeps the flag out of the forbidden list: raising it over an already flagged row works', async () => {
            const { id } = await classifyNewCase({ dIsUnclassifiable: true });

            expect((await update(id, { dIsUnclassifiable: true })).status).toBe(200);
        });

    });

    describe('ESAVI-FINCLASS-004 — the precedence rule over the resulting state', () => {

        it('does not fail on a PUT that touches nothing related', async () => {
            const { id } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId
            });

            expect((await update(id, { notes: 'x' })).status).toBe(200);
        });

        it('fails on a single slot that collides with the STORED one', async () => {
            const { id } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId
            });

            // importanceAItemId never travels: an implementation comparing only the body lets
            // this through and the row ends up with two blocks in the same position
            const response = await update(id, { importanceBItemId: importanceOneId });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('FINCLASS_004_IMPORTANCE_DUPLICATED');
        });

        it('accepts the same move once the stored slot is erased in the same body', async () => {
            const { id } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                importanceBItemId: importanceTwoId
            });

            const response = await update(id, {
                importanceAItemId: null,
                importanceBItemId: importanceOneId
            });

            expect(response.status).toBe(200);
            expect(response.body.data.importanceA).toBeNull();
            expect(response.body.data.importanceB).toEqual(expect.objectContaining({ code: '1' }));
        });

        it('answers 404 for an importance that is inactive, even if nothing else changes', async () => {
            const { id } = await classifyNewCase();

            const response = await update(id, { importanceAItemId: inactiveImportanceId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('FINCLASS_004_IMPORTANCE_NOT_FOUND');
        });

    });

    describe('ESAVI-FINCLASS-004 — the differential update of SPEC F12', () => {

        it('writes nothing when the response of the GET is sent back whole', async () => {
            const { id } = await classifyNewCase({
                importanceAItemId: importanceOneId,
                notes: 'estable'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/final-classifications',
                id,
                model: FinalClassification,
                role: 'USER'
            });
        });

        it('writes nothing on an empty body', async () => {
            const { id } = await classifyNewCase({ notes: 'estable' });
            const versionBefore = await versionOf(id);
            const updatedAtBefore = ( await rowOf(id) ).getDataValue('updatedAt');

            const response = await update(id, {});

            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(await versionOf(id)).toBe(versionBefore);
            expect(( await rowOf(id) ).getDataValue('updatedAt')).toEqual(updatedAtBefore);
        });

        it('writes nothing when only the spacing of notes changes: the trim runs before comparing', async () => {
            const { id } = await classifyNewCase({ notes: 'texto' });
            const versionBefore = await versionOf(id);

            const response = await update(id, { notes: '  texto  ' });

            expect(response.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('writes nothing when a stored false is sent back as false', async () => {
            const { id } = await classifyNewCase({ aIsRelatedToStress: false });
            const versionBefore = await versionOf(id);

            // The false has to be compared as a value: discarded as an absence it would look
            // like a change against the stored null every single time
            const response = await update(id, { aIsRelatedToStress: false });

            expect(response.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('writes nothing when D is raised over a row that was already unclassifiable and empty', async () => {
            const { id } = await classifyNewCase({ dIsUnclassifiable: true });
            const versionBefore = await versionOf(id);

            // The forcing to null goes through the diff like any other candidate: with the ten
            // columns already null there is nothing to write
            const response = await update(id, { dIsUnclassifiable: true });

            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('goes through buildDifferentialUpdate and not through a hand-rolled delete', async () => {
            const source = fs.readFileSync('src/services/finalClassification.service.ts', 'utf8');

            expect(source).toContain('buildDifferentialUpdate');
            expect(source).not.toContain('delete objectToUpdate');
        });

    });

    describe('ESAVI-FINCLASS-005A and 005B — deactivate and reactivate', () => {

        it('seals isActive and deletedAt, and answers 409 the second time', async () => {
            const { id } = await classifyNewCase();

            const first = await remove(id);
            const second = await remove(id);
            const row = await rowOf(id);

            expect(first.status).toBe(200);
            expect(row.getDataValue('isActive')).toBe(false);
            expect(row.getDataValue('deletedAt')).not.toBeNull();
            expect(second.status).toBe(409);
            expect(second.body.code).toBe('FINCLASS_005A_ALREADY_INACTIVE');
        });

        it('reverses it and answers 409 the second time', async () => {
            const { id } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);

            const first = await activate(id);
            const second = await activate(id);

            expect(first.status).toBe(200);
            expect(( await rowOf(id) ).getDataValue('isActive')).toBe(true);
            expect(second.status).toBe(409);
            expect(second.body.code).toBe('FINCLASS_005B_ALREADY_ACTIVE');
        });

        it('records the operation code of each direction in appDetails', async () => {
            const { id } = await classifyNewCase();
            await remove(id);
            await activate(id);

            const appDetails = ( await rowOf(id) ).getDataValue('appDetails') as { method: string }[];
            const methods = appDetails.map(entry => entry.method);

            expect(methods).toContain('ESAVI-FINCLASS-005A');
            expect(methods).toContain('ESAVI-FINCLASS-005B');
        });

        it('does not touch the case: the cascade only goes down', async () => {
            const { id, caseId } = await classifyNewCase();

            expect((await remove(id)).status).toBe(200);

            const esaviCase = await EsaviCase.findByPk(caseId);
            expect(esaviCase!.getDataValue('isActive')).toBe(true);
        });

        it('answers 403 to an ADMIN on activate', async () => {
            const { id } = await classifyNewCase();
            await remove(id);

            expect((await activate(id, 'ADMIN')).status).toBe(403);
        });

    });

    describe('ESAVI-FINCLASS-005C — physical delete', () => {

        const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const logOffset = (): number =>
            fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;

        const readLogSince = ( offset: number ): string =>
            fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').slice(offset) : '';

        // log4js flushes asynchronously, so the line is not on disk the instant the response returns
        const flushLog = () => new Promise(resolve => setTimeout(resolve, 250));

        it('answers 409 over a row that is still active', async () => {
            const { id } = await classifyNewCase();

            const response = await purge(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('FINCLASS_005C_STILL_ACTIVE');
        });

        it('answers 403 to an ADMIN', async () => {
            const { id } = await classifyNewCase();
            await remove(id);

            expect((await purge(id, 'ADMIN')).status).toBe(403);
        });

        it('destroys an inactive row, answers without data and dumps it in warn', async () => {
            const { id } = await classifyNewCase({ notes: 'a purgar' });
            expect((await remove(id)).status).toBe(200);

            const offset = logOffset();
            const response = await purge(id);

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data).toBeUndefined();
            expect(await FinalClassification.findByPk(id)).toBeNull();

            await flushLog();
            const lines = readLogSince(offset)
                .split(/\r?\n/)
                .filter(line => line.includes('ESAVI-FINCLASS-005C') && line.includes('Snapshot'));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('a purgar');
        });

        it('releases the caseId: only the physical delete frees the slot', async () => {
            const { id, caseId } = await classifyNewCase();
            expect((await remove(id)).status).toBe(200);
            expect((await create({ caseId })).status).toBe(409);

            expect((await purge(id)).status).toBe(200);

            expect((await create({ caseId })).status).toBe(201);
        });

    });

    describe('the cascade of ESAVI-CASE-005A', () => {

        const deactivateCase = ( caseId: string ) =>
            request(app).delete(`/api/esavi-cases/${ caseId }`).set(authHeader('ADMIN'));

        const activateCase = ( caseId: string ) =>
            request(app).patch(`/api/esavi-cases/activate/${ caseId }`).set(authHeader('SUPERADMIN'));

        it('deactivates the active final classification of the case', async () => {
            const { id, caseId } = await classifyNewCase();

            expect((await deactivateCase(caseId)).status).toBe(200);

            const row = await rowOf(id);
            expect(row.getDataValue('isActive')).toBe(false);
            expect(row.getDataValue('deletedAt')).not.toBeNull();

            const appDetails = row.getDataValue('appDetails') as { method: string }[];
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-CASE-005A');
        });

        it('does NOT reactivate it when the case comes back: the cascade only goes down', async () => {
            const { id, caseId } = await classifyNewCase();
            expect((await deactivateCase(caseId)).status).toBe(200);

            expect((await activateCase(caseId)).status).toBe(200);

            expect(( await rowOf(id) ).getDataValue('isActive')).toBe(false);
        });

        it('deactivates a case with no final classification without failing', async () => {
            const caseId = await createCaseFixture();

            expect((await deactivateCase(caseId)).status).toBe(200);
        });

    });

});
