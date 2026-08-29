import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationAutopsy, InvestigationMedicalHistory, InvestigationSource, InvestigationTeamMember, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationMedicalHistory operations of SPEC F32. It walks
 * the entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access by
 * case, and the pregnancy block evaluated over the resulting state.
 *
 * Four things separate this entity from its sisters F29 and F30 and get deliberate coverage:
 *
 *  - It is the first satellite of investigation that consumes answerOption, and it does so
 *    on five columns. Over that ENUM the "no" has FOUR forms — 'NO', 'UNKNOWN',
 *    'NOT_APPLICABLE' and 'NO_ANSWER' — plus the null of "it was never asked", and all five
 *    close the pregnancy block. A rule written against the truthiness of the value would
 *    work by accident in four of the five cases, so 'UNKNOWN' gets its own case.
 *  - birthWeightGrams is the first numeric column of the domain in the repository. pg reads
 *    it back as the string '3250.00', so a client resending the number its GET returned
 *    would produce an invented difference on every open of the form if DECIMAL had been
 *    declared FLOAT or if the diff compared with !==.
 *  - The nine gestational fields are CONDITIONAL DERIVATIVES: closing the block empties them
 *    in the same request, with one appDetails entry, and closing an already closed block
 *    writes nothing at all.
 *  - It has four foreign keys to catalogItem and the DDL seeds none of their catalogTypes,
 *    so the suite seeds them itself in beforeAll.
 *
 * The 0 gets deliberate coverage of its own on both numeric columns: an `if( data.x )` in
 * the service would make it impossible to store a gestationalWeeks of 0 — a valid value of
 * the CHECK — while still answering 200.
 */
describe('investigationMedicalHistory contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const path = '/api/investigation-medical-histories';

    let statusZeroItemId: string;

    // One active item per catalog, plus a retired one and a foreign one to prove the double hop
    let gestationMethodItemId: string;
    let deliveryItemId: string;
    let birthItemId: string;
    let pregnancyOutcomeItemId: string;
    let retiredDeliveryItemId: string;
    let foreignItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // Every fixture is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`History ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`MH${ counter }${ suffix }`),
            healthSystemCode: `MH${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `MH${ counter }${ suffix }`,
            name: `History ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `MH-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    // statusItemId is passed explicitly: an investigation created straight through the model
    // skips the service of F28 that resolves the default status, and its `status` would come
    // back null — which this suite asserts never happens
    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> =>
        await createInvestigationForCase(await createCaseFixture(), isActive);

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post(path).set(authHeader(role)).send(payload);

    // The empty create of this entity, and the difference with F30: { investigationId } is
    // the whole minimum. Mints an investigation and its medical history in one go
    const seed = async (payload: Record<string, unknown> = {}): Promise<string> => {
        const investigationId = await createInvestigationFixture();
        const res = await create({ investigationId, ...payload });
        expect(res.status).toBe(201);
        return investigationId;
    };

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ path }/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`${ path }/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`${ path }${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`${ path }/admin${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ path }/${ id }`).set(authHeader(role)).send(payload);

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ path }/purge/${ id }`).set(authHeader(role));

    const readRow = async (id: string) => await InvestigationMedicalHistory.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationMedicalHistory.update({ deletedAt: at }, { where: { investigationId } });

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    // The four data columns of the pregnancy block that are not foreign keys, plus the four
    // that are: the nine the block governs
    const pregnancyBlockFields = [
        'gestationalWeeks', 'gestationMethodItemId', 'deliveryItemId', 'birthItemId',
        'pregnancyOutcomeItemId', 'hasPregnancyRiskFactor', 'riskFactorDescription',
        'birthWeightGrams', 'wasBreastfed'
    ];

    const dataColumns = [
        'hasPriorHospitalizationHistory', 'priorHospitalizationObservations', 'hasFamilyHistory',
        'familyHistoryObservations', 'isPregnancyConfirmed', ...pregnancyBlockFields, 'notes'
    ];

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        statusZeroItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: statusType!.getDataValue('catalogTypeId'), code: '0' }
        }))!.getDataValue('catalogItemId');

        // The DDL DOES seed the four catalogTypes this entity needs — gestationMethod, deliveryType,
        // birthCondition and pregnancyOutcome all carry official items since SPEC F41. The suite used
        // to CatalogType.create() them unconditionally, which violated UQ_catalogType_code the moment
        // it ran against the seeded database: a collision, not an absence. It now finds the type and
        // adds only its own item, with a suffix that keeps it from colliding with anything official
        const seedCatalog = async (code: string, name: string, itemCode: string): Promise<[string, string]> => {
            const type = await CatalogType.findOne({ where: { code } })
                ?? await CatalogType.create({ code, name });
            const item = await CatalogItem.create({
                catalogTypeId: type.getDataValue('catalogTypeId'),
                code: itemCode, name, value: itemCode
            });
            return [type.getDataValue('catalogTypeId'), item.getDataValue('catalogItemId')];
        };

        [, gestationMethodItemId] = await seedCatalog('gestationMethod', 'Gestation Method', `MHGES${ suffix }`);
        const [deliveryTypeId, activeDelivery] = await seedCatalog('deliveryType', 'Delivery Type', `MHDEL${ suffix }`);
        deliveryItemId = activeDelivery;
        [, birthItemId] = await seedCatalog('birthCondition', 'Birth Condition', `MHBIR${ suffix }`);
        [, pregnancyOutcomeItemId] = await seedCatalog('pregnancyOutcome', 'Pregnancy Outcome', `MHPRG${ suffix }`);

        // A retired item of a correct catalog, and an item of a catalog that is none of the four:
        // the two ways the double hop of the service can fail
        retiredDeliveryItemId = (await CatalogItem.create({
            catalogTypeId: deliveryTypeId,
            code: `MHRET${ suffix }`, name: 'Retired', value: 'retired', isActive: false
        })).getDataValue('catalogItemId');

        const outcomeType = await CatalogType.findOne({ where: { code: 'outcome' } });
        foreignItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: outcomeType!.getDataValue('catalogTypeId') }
        }))!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('opens the row empty: { investigationId } answers 201 with the fifteen columns null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            const data = res.body.data;

            expect(data.investigationId).toBe(investigationId);
            for( const column of dataColumns ) {
                expect(data[column]).toBeNull();
            }
            for( const alias of ['gestationMethod', 'delivery', 'birth', 'pregnancyOutcome'] ) {
                expect(data[alias]).toBeNull();
            }
            expect(data.deletedAt).toBeNull();
            expect(data.appDetails[0].method).toBe('ESAVI-INVMEDH-001');
        });

        it('the investigation travels resolved, and neither isActive nor sysDetails do', async () => {
            const id = await seed();
            const data = (await getById(id)).body.data;

            expect(data.investigation.investigationId).toBe(id);
            expect(data.investigation.status).not.toBeNull();
            expect(data.investigation.case.caseId).toBeDefined();

            expect(data).not.toHaveProperty('isActive');
            for( const object of [data, data.investigation, data.investigation.status, data.investigation.case] ) {
                expect(object).not.toHaveProperty('sysDetails');
            }
        });

        it('stores the fifteen columns when they travel, trimming the four free texts', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hasPriorHospitalizationHistory: 'YES', priorHospitalizationObservations: '  ingreso previo  ',
                hasFamilyHistory: 'NO', familyHistoryObservations: '  sin antecedentes  ',
                isPregnancyConfirmed: 'YES', gestationalWeeks: 38,
                gestationMethodItemId, deliveryItemId, birthItemId, pregnancyOutcomeItemId,
                hasPregnancyRiskFactor: 'YES', riskFactorDescription: '  hipertensión  ',
                birthWeightGrams: 3250, wasBreastfed: 'YES', notes: '  una nota  '
            });

            expect(res.status).toBe(201);
            const data = res.body.data;
            expect(data.priorHospitalizationObservations).toBe('ingreso previo');
            expect(data.familyHistoryObservations).toBe('sin antecedentes');
            expect(data.riskFactorDescription).toBe('hipertensión');
            expect(data.notes).toBe('una nota');
            expect(data.gestationalWeeks).toBe(38);
            expect(data.gestationMethod).toMatchObject({ catalogItemId: gestationMethodItemId });
            expect(data.delivery).toMatchObject({ catalogItemId: deliveryItemId });
            expect(data.birth).toMatchObject({ catalogItemId: birthItemId });
            expect(data.pregnancyOutcome).toMatchObject({ catalogItemId: pregnancyOutcomeItemId });
        });

        it('returns birthWeightGrams as a STRING, which is what DECIMAL gives through pg', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', birthWeightGrams: 3250 });
            expect((await getById(id)).body.data.birthWeightGrams).toBe('3250.00');
        });

        it('answers 404 when the investigation does not exist or is inactive', async () => {
            const missing = await create({ investigationId: unknownUuid });
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('INVMEDH_001_INVESTIGATION_NOT_FOUND');

            const retired = await createInvestigationFixture(false);
            const onRetired = await create({ investigationId: retired });
            expect(onRetired.status).toBe(404);
            expect(onRetired.body.code).toBe('INVMEDH_001_INVESTIGATION_NOT_FOUND');
        });

        it('answers 409 on the second create, with the investigationId interpolated', async () => {
            const id = await seed();
            const duplicate = await create({ investigationId: id });

            expect(duplicate.status).toBe(409);
            expect(duplicate.body.code).toBe('INVMEDH_001_ALREADY_EXISTS');
            expect(duplicate.body.message).toContain(id);
        });

        it('answers 409 over a SEALED row too: the seal does not release the slot', async () => {
            const id = await seed();
            await seal(id);

            const res = await create({ investigationId: id });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVMEDH_001_ALREADY_EXISTS');
        });

        it('answers 400 without investigationId — never an integrity error of Postgres', async () => {
            const res = await create({ hasFamilyHistory: 'YES' });
            expect(res.status).toBe(400);
        });

        it('answers 400 on the two ranges, and 201 on their 0', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, isPregnancyConfirmed: 'YES', gestationalWeeks: 46 })).status).toBe(400);
            expect((await create({ investigationId, isPregnancyConfirmed: 'YES', gestationalWeeks: -1 })).status).toBe(400);
            expect((await create({ investigationId, isPregnancyConfirmed: 'YES', birthWeightGrams: -1 })).status).toBe(400);

            const res = await create({ investigationId, isPregnancyConfirmed: 'YES', gestationalWeeks: 0, birthWeightGrams: 0 });
            expect(res.status).toBe(201);
            expect(res.body.data.gestationalWeeks).toBe(0);
            expect(res.body.data.birthWeightGrams).toBe('0.00');
        });

        it('answers 400 on an answerOption outside the five values, and 201 on each of them', async () => {
            expect((await create({ investigationId: await createInvestigationFixture(), hasFamilyHistory: 'MAYBE' })).status).toBe(400);

            for( const value of ['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] ) {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, hasFamilyHistory: value });
                expect(res.status).toBe(201);
                expect(res.body.data.hasFamilyHistory).toBe(value);
            }
        });

        it('keeps null and NO_ANSWER apart: neither is normalized into the other', async () => {
            const asked = await seed({ hasFamilyHistory: 'NO_ANSWER' });
            expect((await getById(asked)).body.data.hasFamilyHistory).toBe('NO_ANSWER');

            const notAsked = await seed();
            expect((await getById(notAsked)).body.data.hasFamilyHistory).toBeNull();
        });

        it('does not tie the two observation texts to their flag', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                hasFamilyHistory: 'NO', familyHistoryObservations: 'texto',
                priorHospitalizationObservations: 'por qué es UNKNOWN'
            });
            expect(res.status).toBe(201);
            expect(res.body.data.familyHistoryObservations).toBe('texto');
            expect(res.body.data.priorHospitalizationObservations).toBe('por qué es UNKNOWN');
        });
    });

    describe('001 — the pregnancy block', () => {

        it('answers 400 with the offending field interpolated when the block is closed', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isPregnancyConfirmed: 'NO', gestationalWeeks: 38 });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVMEDH_001_PREGNANCY_FIELDS_NOT_ALLOWED');
            expect(res.body.message).toContain('gestationalWeeks');
        });

        it('answers 400 when the key does not travel at all: null is not YES', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, gestationalWeeks: 38 })).status).toBe(400);
        });

        it('closes the block with the four forms of the "no", UNKNOWN included', async () => {
            for( const value of ['NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'] ) {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, isPregnancyConfirmed: value, wasBreastfed: 'YES' });
                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVMEDH_001_PREGNANCY_FIELDS_NOT_ALLOWED');
            }
        });

        it('rejects a gestationalWeeks of 0 with the block closed: 0 IS content', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, isPregnancyConfirmed: 'NO', gestationalWeeks: 0 })).status).toBe(400);
        });

        it('admits the nine sent as null with the block closed', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId, isPregnancyConfirmed: 'NO',
                gestationalWeeks: null, birthWeightGrams: null, wasBreastfed: null, deliveryItemId: null
            });
            expect(res.status).toBe(201);
        });

        it('admits YES with none of the nine: confirming the pregnancy forces nothing', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isPregnancyConfirmed: 'YES' });
            expect(res.status).toBe(201);
            for( const field of pregnancyBlockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
        });
    });

    describe('001 — the four foreign keys to catalogItem', () => {

        it('answers 404 with its own key when the item does not exist', async () => {
            const investigationId = await createInvestigationFixture();
            const cases: [string, string][] = [
                ['gestationMethodItemId', 'INVMEDH_001_GESTATION_METHOD_NOT_FOUND'],
                ['deliveryItemId', 'INVMEDH_001_DELIVERY_NOT_FOUND'],
                ['birthItemId', 'INVMEDH_001_BIRTH_NOT_FOUND'],
                ['pregnancyOutcomeItemId', 'INVMEDH_001_PREGNANCY_OUTCOME_NOT_FOUND']
            ];
            for( const [field, code] of cases ) {
                const res = await create({ investigationId, isPregnancyConfirmed: 'YES', [field]: unknownUuid });
                expect(res.status).toBe(404);
                expect(res.body.code).toBe(code);
            }
        });

        it('answers 404 when the item is inactive', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isPregnancyConfirmed: 'YES', deliveryItemId: retiredDeliveryItemId });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVMEDH_001_DELIVERY_NOT_FOUND');
        });

        it('answers 404 when the item belongs to ANOTHER catalogType', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isPregnancyConfirmed: 'YES', pregnancyOutcomeItemId: foreignItemId });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVMEDH_001_PREGNANCY_OUTCOME_NOT_FOUND');
        });

        it('does not resolve a key the block is going to null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, isPregnancyConfirmed: 'NO', deliveryItemId: null });
            expect(res.status).toBe(201);
        });
    });

    describe('002A and 002B — the two listings', () => {

        it('hides the rows of inactive investigations in 002A and shows them in 002B', async () => {
            const visible = await seed();
            const hidden = await seed();
            await retireInvestigation(hidden);

            const publicIds = (await list('?limit=100')).body.data.rows.map((r: { investigationId: string }) => r.investigationId);
            expect(publicIds).toContain(visible);
            expect(publicIds).not.toContain(hidden);

            const adminIds = (await listAdmin('?limit=100')).body.data.rows.map((r: { investigationId: string }) => r.investigationId);
            expect(adminIds).toContain(hidden);
        });

        it('answers 403 to a USER on /admin', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });

        it('combines the two filters with AND and by equality', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            expect((await list(`?investigationId=${ investigationId }`)).body.data.count).toBe(1);
            expect((await list(`?caseId=${ caseId }`)).body.data.count).toBe(1);
            expect((await list(`?investigationId=${ investigationId }&caseId=${ caseId }`)).body.data.count).toBe(1);
            // The AND: the right investigation under the wrong case matches nothing
            expect((await list(`?investigationId=${ investigationId }&caseId=${ unknownUuid }`)).body.data.count).toBe(0);
        });

        it('answers 200 with count 0 on a filter that matches nothing, not 404', async () => {
            const res = await list(`?caseId=${ unknownUuid }`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ count: 0, rows: [] });
        });

        it('returns the same full shape as the 003: there is no reduced shape', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', gestationalWeeks: 38, gestationMethodItemId });
            const row = (await list(`?investigationId=${ id }`)).body.data.rows[0];

            for( const column of [...dataColumns, 'appDetails', 'createdAt', 'updatedAt', 'deletedAt'] ) {
                expect(row).toHaveProperty(column);
            }
            expect(row.gestationMethod).toMatchObject({ catalogItemId: gestationMethodItemId });
            expect(row.investigation.status).not.toBeNull();
            expect(row).not.toHaveProperty('isActive');
            expect(row).not.toHaveProperty('sysDetails');
            expect(row.investigation).not.toHaveProperty('sysDetails');
            expect(row.gestationMethod).not.toHaveProperty('sysDetails');
        });

        it('lists a row with the four catalogs null: the includes are required false', async () => {
            const id = await seed();
            const res = await list(`?investigationId=${ id }`);

            expect(res.body.data.count).toBe(1);
            const row = res.body.data.rows[0];
            for( const alias of ['gestationMethod', 'delivery', 'birth', 'pregnancyOutcome'] ) {
                expect(row[alias]).toBeNull();
            }
        });

        it('orders by createdAt descending and honours limit with the total count', async () => {
            const first = await seed();
            await new Promise(resolve => setTimeout(resolve, 15));
            const second = await seed();

            const res = await list('?limit=2');
            expect(res.body.data.rows).toHaveLength(2);
            expect(res.body.data.rows[0].investigationId).toBe(second);
            expect(res.body.data.rows[1].investigationId).toBe(first);
            expect(res.body.data.count).toBeGreaterThan(2);
        });
    });

    describe('003 — get by ID', () => {

        it('answers 404 on an id that does not exist', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVMEDH_003_NOT_FOUND');
        });

        it('answers 400 on an id that is not a UUID', async () => {
            expect((await getById('no-es-uuid')).status).toBe(400);
        });

        it('does not capture the literal paths as an :id', async () => {
            expect((await getById('admin', 'ADMIN')).status).toBe(200);
        });

        it('answers 404 for USER and ADMIN when the investigation is inactive, and 200 for SUPERADMIN', async () => {
            const id = await seed();
            await retireInvestigation(id);

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'ADMIN')).status).toBe(404);

            const superadmin = await getById(id, 'SUPERADMIN');
            expect(superadmin.status).toBe(200);
            expect(superadmin.body.data.investigation.isActive).toBe(false);
        });

        it('returns a row with deletedAt sealed while its investigation is active', async () => {
            const id = await seed();
            await seal(id);

            const res = await getById(id);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });
    });

    describe('006 — get by case', () => {

        it('returns the record itself, not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, hasFamilyHistory: 'YES' });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(false);
            expect(res.body.data).not.toHaveProperty('count');
            expect(res.body.data).not.toHaveProperty('rows');
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
        });

        it('carries three DISTINCT 404 codes, one per broken link of the chain', async () => {
            const noCase = await getByCase(unknownUuid);
            expect(noCase.status).toBe(404);
            expect(noCase.body.code).toBe('INVMEDH_006_CASE_NOT_FOUND');

            const orphanCase = await createCaseFixture();
            const noInvestigation = await getByCase(orphanCase);
            expect(noInvestigation.status).toBe(404);
            expect(noInvestigation.body.code).toBe('INVMEDH_006_INVESTIGATION_NOT_FOUND');

            const emptyCase = await createCaseFixture();
            await createInvestigationForCase(emptyCase);
            const noHistory = await getByCase(emptyCase);
            expect(noHistory.status).toBe(404);
            expect(noHistory.body.code).toBe('INVMEDH_006_NOT_FOUND');

            expect(new Set([noCase.body.code, noInvestigation.body.code, noHistory.body.code]).size).toBe(3);
        });

        it('applies the inherited visibility on both hops', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            await retireInvestigation(investigationId);
            expect((await getByCase(caseId)).body.code).toBe('INVMEDH_006_INVESTIGATION_NOT_FOUND');
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);

            await Investigation.update({ isActive: true }, { where: { investigationId } });
            await EsaviCase.update({ isActive: false }, { where: { caseId } });
            expect((await getByCase(caseId)).body.code).toBe('INVMEDH_006_CASE_NOT_FOUND');
        });

        it('answers 400 on a caseId that is not a UUID', async () => {
            expect((await getByCase('no-es-uuid')).status).toBe(400);
        });
    });

    describe('004 — update, differential', () => {

        it('writes nothing when the whole GET response is sent back', async () => {
            const id = await seed({
                hasFamilyHistory: 'NO_ANSWER', familyHistoryObservations: 'texto',
                isPregnancyConfirmed: 'YES', gestationalWeeks: 38, birthWeightGrams: 3250,
                gestationMethodItemId, deliveryItemId, wasBreastfed: 'YES', notes: 'nota'
            });
            await expectPutOfGetResponseWritesNothing({
                path, id, model: InvestigationMedicalHistory, role: 'USER'
            });
        });

        it('writes nothing on an empty body', async () => {
            const id = await seed({ hasFamilyHistory: 'YES' });
            const versionBefore = await versionOf(id);
            const before = (await appDetailsOf(id)).length;

            expect((await update(id, {})).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
            expect(await appDetailsOf(id)).toHaveLength(before);
        });

        it('adds ONE entry and bumps the version by 1 when a single field changes', async () => {
            const id = await seed();
            const versionBefore = await versionOf(id) ?? 0;

            const res = await update(id, { notes: 'una nota' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('una nota');

            const details = await appDetailsOf(id);
            expect(details).toHaveLength(2);
            expect(details[details.length - 1].method).toBe('ESAVI-INVMEDH-004');
            expect(await versionOf(id)).toBe(versionBefore + 1);
        });

        it('stores a gestationalWeeks of 0 over a stored 38: no candidate goes under an if( data.x )', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', gestationalWeeks: 38 });
            const res = await update(id, { gestationalWeeks: 0 });
            expect(res.status).toBe(200);
            expect(res.body.data.gestationalWeeks).toBe(0);

            const emptied = await update(id, { gestationalWeeks: null });
            expect(emptied.body.data.gestationalWeeks).toBeNull();
        });

        it('does not count a resent birthWeightGrams as a change: 3250 equals the stored 3250.00', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', birthWeightGrams: 3250 });
            expect((await getById(id)).body.data.birthWeightGrams).toBe('3250.00');
            const versionBefore = await versionOf(id);

            expect((await update(id, { birthWeightGrams: 3250 })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);

            // The very string the GET returned does not count either
            expect((await update(id, { birthWeightGrams: '3250.00' })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('empties an answerOption with null, and does not count NO_ANSWER over NO_ANSWER', async () => {
            const id = await seed({ hasFamilyHistory: 'NO_ANSWER' });
            const versionBefore = await versionOf(id);

            expect((await update(id, { hasFamilyHistory: 'NO_ANSWER' })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);

            const emptied = await update(id, { hasFamilyHistory: null });
            expect(emptied.status).toBe(200);
            expect(emptied.body.data.hasFamilyHistory).toBeNull();
        });

        it('trims before comparing, and "" empties the text', async () => {
            const id = await seed({ notes: 'nota' });
            const versionBefore = await versionOf(id);

            expect((await update(id, { notes: '   nota   ' })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);

            const emptied = await update(id, { notes: '' });
            expect(emptied.body.data.notes).toBeNull();
        });

        it('ignores a different investigationId in silence, with no 400', async () => {
            const id = await seed();
            const res = await update(id, { investigationId: unknownUuid, notes: 'x' });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(id);
        });

        it('does not re-resolve the four foreign keys sent back as the GET returned them', async () => {
            const id = await seed({
                isPregnancyConfirmed: 'YES',
                gestationMethodItemId, deliveryItemId, birthItemId, pregnancyOutcomeItemId
            });
            const versionBefore = await versionOf(id);

            const res = await update(id, {
                isPregnancyConfirmed: 'YES',
                gestationMethodItemId, deliveryItemId, birthItemId, pregnancyOutcomeItemId
            });
            expect(res.status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('answers 404 on an inactive foreign key even when the rest changes nothing', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', deliveryItemId });
            const res = await update(id, { deliveryItemId: retiredDeliveryItemId });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVMEDH_004_DELIVERY_NOT_FOUND');
        });

        it('answers 404 for USER and ADMIN when the investigation is inactive, and 200 for SUPERADMIN', async () => {
            const id = await seed();
            await retireInvestigation(id);

            expect((await update(id, { notes: 'a' }, 'USER')).status).toBe(404);
            expect((await update(id, { notes: 'b' }, 'ADMIN')).status).toBe(404);
            expect((await update(id, { notes: 'c' }, 'SUPERADMIN')).status).toBe(200);
        });

        it('answers 404 on an id that does not exist', async () => {
            const res = await update(unknownUuid, { notes: 'x' });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVMEDH_004_NOT_FOUND');
        });
    });

    describe('004 — the pregnancy block as a conditional derivative', () => {

        it('empties the nine in the SAME request, with ONE appDetails entry', async () => {
            const id = await seed({
                isPregnancyConfirmed: 'YES', gestationalWeeks: 38,
                gestationMethodItemId, deliveryItemId, birthItemId, pregnancyOutcomeItemId,
                hasPregnancyRiskFactor: 'YES', riskFactorDescription: 'riesgo',
                birthWeightGrams: 3250, wasBreastfed: 'YES'
            });

            const res = await update(id, { isPregnancyConfirmed: 'NO' });
            expect(res.status).toBe(200);
            expect(res.body.data.isPregnancyConfirmed).toBe('NO');
            for( const field of pregnancyBlockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
            expect(await appDetailsOf(id)).toHaveLength(2);
        });

        it('writes NOTHING when the block was already closed', async () => {
            const id = await seed({ isPregnancyConfirmed: 'NO' });
            const versionBefore = await versionOf(id);

            expect((await update(id, { isPregnancyConfirmed: 'NO' })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('does not invent data when the block is opened', async () => {
            const id = await seed({ isPregnancyConfirmed: 'NO' });
            const res = await update(id, { isPregnancyConfirmed: 'YES' });

            expect(res.status).toBe(200);
            expect(res.body.data.isPregnancyConfirmed).toBe('YES');
            for( const field of pregnancyBlockFields ) {
                expect(res.body.data[field]).toBeNull();
            }
        });

        it('answers 400 to a body that contradicts itself, and 200 to an explicit null', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', gestationalWeeks: 38 });

            const contradictory = await update(id, { isPregnancyConfirmed: 'NO', gestationalWeeks: 38 });
            expect(contradictory.status).toBe(400);
            expect(contradictory.body.code).toBe('INVMEDH_004_PREGNANCY_FIELDS_NOT_ALLOWED');
            expect(contradictory.body.message).toContain('gestationalWeeks');

            const explicitNull = await update(id, { isPregnancyConfirmed: 'NO', gestationalWeeks: null });
            expect(explicitNull.status).toBe(200);
            expect(explicitNull.body.data.gestationalWeeks).toBeNull();
        });

        it('looks at the RESULTING state: the key need not travel in the body', async () => {
            const id = await seed({ isPregnancyConfirmed: 'NO' });
            const res = await update(id, { gestationalWeeks: 38 });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVMEDH_004_PREGNANCY_FIELDS_NOT_ALLOWED');
        });

        it('does not resolve against the catalog a key the forcing is about to null', async () => {
            const id = await seed({ isPregnancyConfirmed: 'YES', deliveryItemId });
            // The stored item is retired behind the row's back
            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: deliveryItemId } });

            const res = await update(id, { isPregnancyConfirmed: 'NO' });
            expect(res.status).toBe(200);
            expect(res.body.data.deliveryItemId).toBeNull();

            await CatalogItem.update({ isActive: true }, { where: { catalogItemId: deliveryItemId } });
        });
    });

    describe('005C — purge', () => {

        it('answers 409 on a row without deletedAt sealed, and the row stays', async () => {
            const id = await seed();

            const res = await purge(id);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVMEDH_005C_NOT_DELETED');
            expect(res.body.message).toContain(id);
            expect(await readRow(id)).not.toBeNull();
        });

        it('destroys a sealed row, answers without data, and 404 on the second attempt', async () => {
            const id = await seed();
            await seal(id);

            const res = await purge(id);
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body).not.toHaveProperty('data');
            expect(await readRow(id)).toBeNull();

            const again = await purge(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('INVMEDH_005C_NOT_FOUND');
        });

        it('answers 403 to an ADMIN', async () => {
            const id = await seed();
            await seal(id);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
        });

        it('purges a row hanging from an inactive investigation: no inherited visibility here', async () => {
            const id = await seed();
            await seal(id);
            await retireInvestigation(id);

            expect((await purge(id)).status).toBe(200);
            expect(await readRow(id)).toBeNull();
        });

        it('releases the investigationId: a later POST answers 201', async () => {
            const id = await seed();
            await seal(id);
            expect((await purge(id)).status).toBe(200);

            expect((await create({ investigationId: id })).status).toBe(201);
        });

        it('does not touch the source, the autopsy nor the team members of the same investigation', async () => {
            const id = await seed();
            await InvestigationSource.create({ investigationId: id });
            await InvestigationAutopsy.create({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await InvestigationTeamMember.create({ investigationId: id, fullName: esaviCrypt('Alguien'), sortOrder: 1 });
            await seal(id);

            expect((await purge(id)).status).toBe(200);

            expect(await InvestigationSource.findByPk(id, { paranoid: false })).not.toBeNull();
            expect(await InvestigationAutopsy.findByPk(id, { paranoid: false })).not.toBeNull();
            expect(await InvestigationTeamMember.count({ where: { investigationId: id }, paranoid: false })).toBe(1);
            expect(await Investigation.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('answers 404 on an id that does not exist and 400 on a non UUID', async () => {
            expect((await purge(unknownUuid)).status).toBe(404);
            expect((await purge('no-es-uuid')).status).toBe(400);
        });
    });

    describe('the operations that do not exist', () => {

        it('answers 404 of Express to DELETE /:id and PATCH /activate/:id', async () => {
            const id = await seed();

            expect((await request(app).delete(`${ path }/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).patch(`${ path }/activate/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(404);
        });
    });
});
