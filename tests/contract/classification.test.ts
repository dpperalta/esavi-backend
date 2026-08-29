import request from 'supertest';
import { CatalogItem, CatalogType, Classification, EsaviCase, HealthFacility, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine classification operations of SPEC F09. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the age
 * that is computed from two dates of two other tables instead of being captured,
 * the severity coherence matrix evaluated over the body on create and over the
 * resulting state on update, the one to one relation whose slot is not released
 * by the soft delete, and the tri-state of the nine booleans, where null is a
 * value of its own and never becomes false.
 */
describe('classification contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // Fixtures shared by the whole file. A classification needs a case, and the case needs a
    // patient with a birth date: the age is read through the case, from patient.birthDate
    let yearsItemId: string;
    let monthsItemId: string;
    let daysItemId: string;
    let wrongCatalogItemId: string;
    let inactiveCaseId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // Every case is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (
        options: { birthDate?: string | null, eventDate?: string | null, isActive?: boolean } = {}
    ): Promise<string> => {
        const { birthDate = '2000-05-04', eventDate = '2024-05-04', isActive = true } = options;
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Classification ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CL${ caseCounter }${ suffix }`),
            healthSystemCode: `CL${ caseCounter }${ suffix }`,
            birthDate
        });
        const facility = await HealthFacility.create({
            localCode: `CL${ caseCounter }${ suffix }`,
            name: `Classification ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CL-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate,
            isActive
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // The three ageUnit items ARE seeded by esaviapp.sql, and since SPEC F46 they are the locked
    // rows the service resolves by value. The suite used to find-or-create its own copies keyed by
    // code, which left the catalog with six items running in parallel to the official three — it
    // passed, and it passed by corrupting. It now resolves the seeded rows and creates nothing
    const resolveAgeUnitCatalog = async (): Promise<void> => {
        const items: Record<string, string> = {};
        for( const value of ['YEARS', 'MONTHS', 'DAYS'] ) {
            const item = await CatalogItem.findOne({
                where: { value, isValueLocked: true },
                include: [{ model: CatalogType, as: 'catalogType', where: { code: 'ageUnit' }, attributes: [] }]
            });
            expect(item).not.toBeNull();
            items[value] = item!.getDataValue('catalogItemId');
        }
        yearsItemId = items.YEARS;
        monthsItemId = items.MONTHS;
        daysItemId = items.DAYS;
    };

    const createClassification = ( payload: Record<string, unknown> = {}, role: TestRole = 'USER' ) =>
        request(app)
            .post('/api/classifications')
            .set(authHeader(role))
            .send({ isSeriousEvent: false, ...payload });

    const getClassification = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/classifications/${ id }`).set(authHeader(role));

    const getClassificationByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/classifications/case/${ caseId }`).set(authHeader(role));

    const listClassifications = ( query: string = '', role: TestRole = 'USER' ) =>
        request(app).get(`/api/classifications${ query }`).set(authHeader(role));

    const listAdminClassifications = ( query: string = '', role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/classifications/admin${ query }`).set(authHeader(role));

    const updateClassification = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/classifications/${ id }`).set(authHeader(role)).send(payload);

    const deleteClassification = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/classifications/${ id }`).set(authHeader(role));

    const activateClassification = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/classifications/activate/${ id }`).set(authHeader(role));

    const purgeClassification = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/classifications/purge/${ id }`).set(authHeader(role));

    // A classification over a brand new case, which is the only way to get one
    const classifyNewCase = async ( payload: Record<string, unknown> = {} ): Promise<{ id: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await createClassification({ caseId, ...payload });
        return { id: created.body.data.classificationId, caseId };
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        await resolveAgeUnitCatalog();

        inactiveCaseId = await createCaseFixture({ isActive: false });

        // An item of a different catalogType, to prove the age unit check looks at the type
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

    describe('ESAVI-CLASSIF-001 — create', () => {

        it('creates a classification and answers 201 with the full shape', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({
                caseId,
                firstConsultationDate: '2024-05-06',
                notes: '   A note   '
            });
            const data = response.body.data;

            expect(response.status).toBe(201);
            expect(data.classificationId).toBeDefined();
            expect(data.firstConsultationDate).toBe('2024-05-06');
            expect(data.notes).toBe('A note');
            expect(data.isActive).toBe(true);
            expect(data.case).toEqual(expect.objectContaining({ caseId, eventDate: '2024-05-04' }));
            expect(data.ageUnit).toEqual(expect.objectContaining({ value: 'YEARS' }));
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-CLASSIF-001');
        });

        it('never exposes sysDetails nor the raw foreign keys', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId });

            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.caseId).toBeUndefined();
            expect(response.body.data.ageUnitItemId).toBeUndefined();
        });

        it('stores the booleans that did not arrive as null, never as false', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId });
            const data = response.body.data;

            expect(data.isSeriousEvent).toBe(false);
            expect(data.causedDeath).toBeNull();
            expect(data.causedDisability).toBeNull();
            expect(data.causedCongenitalAnomaly).toBeNull();
            expect(data.causedFetalDeath).toBeNull();
            expect(data.causedLifeThreatening).toBeNull();
            expect(data.causedHospitalization).toBeNull();
            expect(data.causedAbortion).toBeNull();
            expect(data.causedOtherCondition).toBeNull();
        });

        it('answers 404 when the case does not exist', async () => {
            const response = await createClassification({ caseId: unknownUuid });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_001_CASE_NOT_FOUND');
        });

        it('answers 404 when the case is inactive: a retired case is not classified', async () => {
            const response = await createClassification({ caseId: inactiveCaseId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_001_CASE_NOT_FOUND');
        });

        it('answers 400 when caseId is missing or is not a UUID', async () => {
            const missing = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ isSeriousEvent: false });
            const malformed = await createClassification({ caseId: 'not-a-uuid' });

            expect(missing.status).toBe(400);
            expect(malformed.status).toBe(400);
        });

    });

    describe('ESAVI-CLASSIF-001 — the age is computed, not captured', () => {

        it('computes the age and silently ignores what the body sent', async () => {
            const caseId = await createCaseFixture({ birthDate: '2021-05-04', eventDate: '2024-05-04' });

            const response = await createClassification({ caseId, age: 40, ageUnitItemId: daysItemId });

            expect(response.status).toBe(201);
            expect(response.body.data.age).toBe(3);
            expect(response.body.data.ageUnit.value).toBe('YEARS');
        });

        it('resolves seven months in MONTHS', async () => {
            const caseId = await createCaseFixture({ birthDate: '2024-01-15', eventDate: '2024-08-15' });

            const response = await createClassification({ caseId });

            expect(response.body.data.age).toBe(7);
            expect(response.body.data.ageUnit.value).toBe('MONTHS');
        });

        it('resolves twelve days in DAYS', async () => {
            const caseId = await createCaseFixture({ birthDate: '2024-06-01', eventDate: '2024-06-13' });

            const response = await createClassification({ caseId });

            expect(response.body.data.age).toBe(12);
            expect(response.body.data.ageUnit.value).toBe('DAYS');
        });

        it('uses calendar arithmetic on the borders', async () => {
            const exactYear = await createCaseFixture({ birthDate: '2023-01-01', eventDate: '2024-01-01' });
            const exactMonth = await createCaseFixture({ birthDate: '2024-01-01', eventDate: '2024-02-01' });
            const sameDay = await createCaseFixture({ birthDate: '2024-05-04', eventDate: '2024-05-04' });
            const leapDay = await createCaseFixture({ birthDate: '2024-02-29', eventDate: '2025-02-28' });

            const twelveMonths = await createClassification({ caseId: exactYear });
            const oneMonth = await createClassification({ caseId: exactMonth });
            const zeroDays = await createClassification({ caseId: sameDay });
            const notAYear = await createClassification({ caseId: leapDay });

            expect(twelveMonths.body.data).toEqual(expect.objectContaining({ age: 1 }));
            expect(twelveMonths.body.data.ageUnit.value).toBe('YEARS');
            expect(oneMonth.body.data).toEqual(expect.objectContaining({ age: 1 }));
            expect(oneMonth.body.data.ageUnit.value).toBe('MONTHS');
            expect(zeroDays.body.data).toEqual(expect.objectContaining({ age: 0 }));
            expect(zeroDays.body.data.ageUnit.value).toBe('DAYS');
            expect(notAYear.body.data).toEqual(expect.objectContaining({ age: 11 }));
            expect(notAYear.body.data.ageUnit.value).toBe('MONTHS');
        });

        it('falls back to the body when the birth date is missing', async () => {
            const caseId = await createCaseFixture({ birthDate: null });

            const response = await createClassification({ caseId, age: 40, ageUnitItemId: yearsItemId });

            expect(response.status).toBe(201);
            expect(response.body.data.age).toBe(40);
            expect(response.body.data.ageUnit.value).toBe('YEARS');
        });

        it('falls back to the body when the event date is missing', async () => {
            const caseId = await createCaseFixture({ eventDate: null });

            const response = await createClassification({ caseId, age: 9, ageUnitItemId: monthsItemId });

            expect(response.status).toBe(201);
            expect(response.body.data.age).toBe(9);
            expect(response.body.data.ageUnit.value).toBe('MONTHS');
        });

        it('does not use reportDate as a stand-in for eventDate', async () => {
            const caseId = await createCaseFixture({ eventDate: null });

            const response = await createClassification({ caseId });

            expect(response.status).toBe(201);
            expect(response.body.data.age).toBeNull();
            expect(response.body.data.ageUnit).toBeNull();
        });

        it('answers 400 when only one of age and ageUnitItemId travels', async () => {
            const onlyAge = await createClassification({ caseId: await createCaseFixture({ birthDate: null }), age: 40 });
            const onlyUnit = await createClassification({
                caseId: await createCaseFixture({ birthDate: null }),
                ageUnitItemId: yearsItemId
            });

            expect(onlyAge.status).toBe(400);
            expect(onlyUnit.status).toBe(400);
        });

        it('answers 404 when the received age unit belongs to another catalog', async () => {
            const caseId = await createCaseFixture({ birthDate: null });

            const response = await createClassification({ caseId, age: 40, ageUnitItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_001_AGEUNIT_NOT_FOUND');
        });

        // Since SPEC F46 the unit is resolved by { value, isValueLocked: true } with no isActive
        // filter, so what leaves the catalog unresolvable is the missing lock and not a deactivation
        it('answers 404 with its own code when the ageUnit catalog is not locked', async () => {
            await CatalogItem.update({ isValueLocked: false }, { where: { catalogItemId: yearsItemId } });
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId });

            await CatalogItem.update({ isValueLocked: true }, { where: { catalogItemId: yearsItemId } });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_001_AGEUNIT_CATALOG_MISSING');
        });

        // The counterpart, and the reason that filter was dropped: a withdrawn item still names what
        // it always named
        it('resolves the unit even when the seeded item was deactivated', async () => {
            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: yearsItemId } });
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId });

            await CatalogItem.update({ isActive: true }, { where: { catalogItemId: yearsItemId } });
            expect(response.status).toBe(201);
            expect(response.body.data.ageUnit.value).toBe('YEARS');
        });

        it('answers 409 when the event precedes the birth, and stores nothing', async () => {
            const caseId = await createCaseFixture({ birthDate: '2024-08-15', eventDate: '2020-01-01' });

            const response = await createClassification({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_001_INVALID_AGE_RANGE');
            expect(await Classification.count({ where: { caseId } })).toBe(0);
        });

    });

    describe('ESAVI-CLASSIF-001 — the severity coherence matrix', () => {

        it('answers 400 with no criterion and no isSeriousEvent', async () => {
            const caseId = await createCaseFixture();

            const response = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ caseId });

            expect(response.status).toBe(400);
        });

        it('answers 400 with isSeriousEvent true and no criterion', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId, isSeriousEvent: true });

            expect(response.status).toBe(400);
        });

        it('accepts isSeriousEvent false with no criterion', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId, isSeriousEvent: false });

            expect(response.status).toBe(201);
            expect(response.body.data.isSeriousEvent).toBe(false);
        });

        it('derives isSeriousEvent to true when a criterion arrives, however the flag came', async () => {
            const asFalse = await createClassification({ caseId: await createCaseFixture(), causedDeath: true, isSeriousEvent: false });
            const absent = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ caseId: await createCaseFixture(), causedHospitalization: true });

            expect(asFalse.status).toBe(201);
            expect(asFalse.body.data.isSeriousEvent).toBe(true);
            expect(absent.status).toBe(201);
            expect(absent.body.data.isSeriousEvent).toBe(true);
        });

        it('answers 400 when causedOtherCondition is true with no description', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({ caseId, causedOtherCondition: true });

            expect(response.status).toBe(400);
        });

        it('accepts causedOtherCondition true with a description', async () => {
            const caseId = await createCaseFixture();

            const response = await createClassification({
                caseId,
                causedOtherCondition: true,
                otherSeriousConditionDescription: 'Persistent seizures'
            });

            expect(response.status).toBe(201);
            expect(response.body.data.isSeriousEvent).toBe(true);
            expect(response.body.data.otherSeriousConditionDescription).toBe('Persistent seizures');
        });

    });

    describe('ESAVI-CLASSIF-001 — one to one with the case', () => {

        it('answers 409 on the second classification of a case, with the caseId in the message', async () => {
            const { caseId } = await classifyNewCase();

            const response = await createClassification({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_001_CASE_ALREADY_CLASSIFIED');
            expect(response.body.message).toContain(caseId);
        });

        it('answers 409 too when the existing classification is inactive: the slot is not released', async () => {
            const { id, caseId } = await classifyNewCase();
            await deleteClassification(id);

            const response = await createClassification({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_001_CASE_ALREADY_CLASSIFIED');
        });

    });

    describe('ESAVI-CLASSIF-002A / 002B — list', () => {

        it('the public listing hides the inactive ones and the admin listing shows them', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const publicList = await listClassifications('?limit=100');
            const adminList = await listAdminClassifications('?limit=100');
            const ids = ( body: { data: { rows: { classificationId: string }[] } } ) =>
                body.data.rows.map((row) => row.classificationId);

            expect(ids(publicList.body)).not.toContain(id);
            expect(ids(adminList.body)).toContain(id);
        });

        it('a USER gets 403 on the admin listing', async () => {
            const response = await listAdminClassifications('', 'USER');

            expect(response.status).toBe(403);
        });

        it('returns the reduced shape: the nine booleans travel, notes and appDetails do not', async () => {
            const { caseId } = await classifyNewCase({ causedDeath: true, notes: 'Not in the list' });

            const response = await listClassifications(`?caseId=${ caseId }`);
            const row = response.body.data.rows[0];

            expect(row.isSeriousEvent).toBe(true);
            expect(row.causedDeath).toBe(true);
            expect(row.causedAbortion).toBeNull();
            expect(row).toHaveProperty('otherSeriousConditionDescription');
            expect(row.notes).toBeUndefined();
            expect(row.appDetails).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
            expect(row.createdAt).toBeUndefined();
            expect(row.case.eventDate).toBe('2024-05-04');
        });

        it('filters by isSeriousEvent without returning the ones holding null', async () => {
            await classifyNewCase({ causedDeath: true });

            const serious = await listAdminClassifications('?isSeriousEvent=true&limit=100');
            const notSerious = await listAdminClassifications('?isSeriousEvent=false&limit=100');

            expect(serious.body.data.count).toBeGreaterThan(0);
            expect(serious.body.data.rows.every((row: { isSeriousEvent: boolean }) => row.isSeriousEvent === true)).toBe(true);
            expect(notSerious.body.data.count).toBeGreaterThan(0);
            expect(notSerious.body.data.rows.every((row: { isSeriousEvent: boolean }) => row.isSeriousEvent === false)).toBe(true);
        });

        it('filters by ageUnitItemId', async () => {
            const caseId = await createCaseFixture({ birthDate: '2024-06-01', eventDate: '2024-06-13' });
            await createClassification({ caseId });

            const response = await listClassifications(`?ageUnitItemId=${ daysItemId }&limit=100`);

            expect(response.body.data.count).toBeGreaterThan(0);
            expect(response.body.data.rows.every((row: { ageUnit: { value: string } }) => row.ageUnit.value === 'DAYS')).toBe(true);
        });

        it('answers 200 with an empty page for a foreign key that does not exist', async () => {
            const response = await listClassifications(`?caseId=${ unknownUuid }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
            expect(response.body.data.rows).toEqual([]);
        });

        it('accumulates the three filters with AND', async () => {
            const { caseId } = await classifyNewCase({ causedDeath: true });

            const match = await listClassifications(`?caseId=${ caseId }&isSeriousEvent=true&ageUnitItemId=${ yearsItemId }`);
            const mismatch = await listClassifications(`?caseId=${ caseId }&isSeriousEvent=false&ageUnitItemId=${ yearsItemId }`);

            expect(match.body.data.count).toBe(1);
            expect(mismatch.body.data.count).toBe(0);
        });

        it('paginates and orders by createdAt DESC', async () => {
            const { id } = await classifyNewCase();

            const page = await listAdminClassifications('?limit=2');
            const full = await listAdminClassifications('?limit=100');

            expect(page.body.data.rows).toHaveLength(2);
            expect(page.body.data.count).toBeGreaterThan(2);
            expect(full.body.data.rows[0].classificationId).toBe(id);
        });

        it('answers 400 for a malformed filter', async () => {
            const response = await listClassifications('?caseId=not-a-uuid');

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-CLASSIF-003 — get by id', () => {

        it('returns the full shape', async () => {
            const { id, caseId } = await classifyNewCase({ notes: 'Visible here' });

            const response = await getClassification(id);

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Visible here');
            expect(response.body.data.case.caseId).toBe(caseId);
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        it('answers 404 for an unknown id', async () => {
            const response = await getClassification(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_003_NOT_FOUND');
        });

        it('hides an inactive classification from USER and ADMIN and shows it to SUPERADMIN', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const asUser = await getClassification(id, 'USER');
            const asAdmin = await getClassification(id, 'ADMIN');
            const asSuperAdmin = await getClassification(id, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asAdmin.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.isActive).toBe(false);
        });

        it('does not capture the literal paths as an :id', async () => {
            const admin = await listAdminClassifications();
            const malformed = await getClassification('not-a-uuid');

            expect(admin.status).toBe(200);
            expect(malformed.status).toBe(400);
        });

    });

    describe('ESAVI-CLASSIF-006 — get by case', () => {

        it('returns the record itself and not a collection', async () => {
            const { id, caseId } = await classifyNewCase({ notes: 'By case' });

            const response = await getClassificationByCase(caseId);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(false);
            expect(response.body.data.count).toBeUndefined();
            expect(response.body.data.rows).toBeUndefined();
            expect(response.body.data.classificationId).toBe(id);
            expect(response.body.data.notes).toBe('By case');
        });

        it('tells an unknown case from a case with no classification', async () => {
            const unclassified = await createCaseFixture();

            const unknownCase = await getClassificationByCase(unknownUuid);
            const noClassification = await getClassificationByCase(unclassified);

            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('CLASSIF_006_CASE_NOT_FOUND');
            expect(noClassification.status).toBe(404);
            expect(noClassification.body.code).toBe('CLASSIF_006_NOT_FOUND');
        });

        it('hides an inactive classification from USER and shows it to SUPERADMIN', async () => {
            const { id, caseId } = await classifyNewCase();
            await deleteClassification(id);

            const asUser = await getClassificationByCase(caseId, 'USER');
            const asSuperAdmin = await getClassificationByCase(caseId, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
        });

        it('answers 400 when the caseId is not a UUID', async () => {
            const response = await getClassificationByCase('not-a-uuid');

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-CLASSIF-004 — update', () => {

        it('updates the free texts, trims them and preserves the audit trail', async () => {
            const { id } = await classifyNewCase({ notes: 'Original' });

            const response = await updateClassification(id, { notes: '   Corrected   ' });

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Corrected');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-CLASSIF-001');
            expect(response.body.data.appDetails[1].method).toBe('ESAVI-CLASSIF-004');
            expect(response.body.data.updatedAt).not.toBeNull();
        });

        it('ignores caseId: the classification stays on its case', async () => {
            const { id, caseId } = await classifyNewCase();
            const otherCaseId = await createCaseFixture();

            const response = await updateClassification(id, { caseId: otherCaseId });

            expect(response.status).toBe(200);
            expect(response.body.data.case.caseId).toBe(caseId);
        });

        it('ignores the age of the body when both dates exist, with no error', async () => {
            const { id } = await classifyNewCase();

            const response = await updateClassification(id, { age: 99, ageUnitItemId: daysItemId });

            expect(response.status).toBe(200);
            expect(response.body.data.age).toBe(24);
            expect(response.body.data.ageUnit.value).toBe('YEARS');
        });

        it('recalculates the age when the birth date of the patient is corrected', async () => {
            const caseId = await createCaseFixture({ birthDate: '2000-01-01', eventDate: '2024-08-15' });
            const created = await createClassification({ caseId });
            const esaviCase = await EsaviCase.findByPk(caseId);
            await Patient.update(
                { birthDate: '2024-01-15' },
                { where: { patientId: esaviCase!.getDataValue('patientId') } }
            );

            const response = await updateClassification(created.body.data.classificationId, {});

            expect(created.body.data.age).toBe(24);
            expect(response.body.data.age).toBe(7);
            expect(response.body.data.ageUnit.value).toBe('MONTHS');
        });

        it('keeps the age informed by hand when there is no way to compute it', async () => {
            const caseId = await createCaseFixture({ birthDate: null });
            const created = await createClassification({ caseId, age: 40, ageUnitItemId: yearsItemId });
            const id = created.body.data.classificationId;

            // An empty update must not erase what the client informed: only a real calculation
            // overwrites it, and here there is no birth date to compute from
            const untouched = await updateClassification(id, {});
            const corrected = await updateClassification(id, { age: 41, ageUnitItemId: yearsItemId });

            expect(untouched.body.data.age).toBe(40);
            expect(untouched.body.data.ageUnit.value).toBe('YEARS');
            expect(corrected.body.data.age).toBe(41);
        });

        it('evaluates the matrix over the resulting state, not over the body', async () => {
            const { id } = await classifyNewCase({ causedDeath: true });

            const withdrawn = await updateClassification(id, { causedDeath: false });
            const withdrawnWithFlag = await updateClassification(id, { causedDeath: false, isSeriousEvent: false });

            expect(withdrawn.status).toBe(400);
            expect(withdrawn.body.code).toBe('CLASSIF_004_SEVERITY_INCOHERENT');
            expect(withdrawnWithFlag.status).toBe(200);
            expect(withdrawnWithFlag.body.data.isSeriousEvent).toBe(false);
        });

        it('derives isSeriousEvent when the update adds a criterion, even sending it false', async () => {
            const { id } = await classifyNewCase();

            const response = await updateClassification(id, { causedAbortion: true, isSeriousEvent: false });

            expect(response.status).toBe(200);
            expect(response.body.data.isSeriousEvent).toBe(true);
        });

        // isBoolean() accepts the string 'true' but does not convert it, and the matrix compares
        // strictly against true so that null never counts as false. Without the toBoolean()
        // sanitiser a JSON body quoting its booleans looked like a body with no criterion at all
        it('accepts the booleans quoted as strings, on create and on update', async () => {
            const caseId = await createCaseFixture();
            const created = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ caseId, isSeriousEvent: 'false' });

            const response = await updateClassification(created.body.data.classificationId, {
                causedOtherCondition: 'true',
                otherSeriousConditionDescription: 'Description of the new condition'
            });

            expect(created.status).toBe(201);
            expect(created.body.data.isSeriousEvent).toBe(false);
            expect(response.status).toBe(200);
            expect(response.body.data.causedOtherCondition).toBe(true);
            expect(response.body.data.isSeriousEvent).toBe(true);
        });

        it('answers 400 when the update sets causedOtherCondition true with no description', async () => {
            const { id } = await classifyNewCase();

            const response = await updateClassification(id, { causedOtherCondition: true });

            expect(response.status).toBe(400);
        });

        // The differential update of CONVENTIONS.md section 11: a PUT that changes nothing
        // writes nothing, so appDetails records changes and not visits to the form
        // updatedAt is already sealed on insert by TRG_classification_setSysDetails, so what
        // proves nothing was written is that it does not move
        it('an empty update answers 200 and writes nothing', async () => {
            const { id } = await classifyNewCase({ notes: 'Untouched' });
            const before = await getClassification(id);

            const response = await updateClassification(id, {});

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Untouched');
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.updatedAt).toBe(before.body.data.updatedAt);
        });

        it('an update identical to the stored state writes nothing either', async () => {
            const { id } = await classifyNewCase({
                causedDeath: true,
                firstConsultationDate: '2024-05-06',
                notes: 'Identical'
            });
            const before = await getClassification(id);

            const response = await updateClassification(id, {
                isSeriousEvent: true,
                causedDeath: true,
                firstConsultationDate: '2024-05-06',
                notes: 'Identical'
            });

            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data).toEqual(before.body.data);
        });

        it('writes only the field that actually changed', async () => {
            const { id } = await classifyNewCase({ notes: 'First' });
            const before = await getClassification(id);

            const response = await updateClassification(id, { isSeriousEvent: false, notes: 'Second' });

            expect(response.body.data.notes).toBe('Second');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.updatedAt).not.toBe(before.body.data.updatedAt);
        });

        it('answers 404 for an unknown id', async () => {
            const response = await updateClassification(unknownUuid, {});

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_004_NOT_FOUND');
        });

    });

    describe('ESAVI-CLASSIF-005A / 005B — deactivate and reactivate', () => {

        it('deactivating seals isActive and deletedAt and answers without data', async () => {
            const { id } = await classifyNewCase();

            const response = await deleteClassification(id);
            const stored = await Classification.findByPk(id);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(stored!.getDataValue('isActive')).toBe(false);
            expect(stored!.getDataValue('deletedAt')).not.toBeNull();
        });

        it('deactivating twice answers 409', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const response = await deleteClassification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_005A_ALREADY_INACTIVE');
        });

        it('reactivating clears deletedAt and records the code with no suffix', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const response = await activateClassification(id);
            const stored = await Classification.findByPk(id);
            const appDetails = stored!.getDataValue('appDetails') as { method: string }[];

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(stored!.getDataValue('deletedAt')).toBeNull();
            expect(appDetails.map((entry) => entry.method))
                .toEqual(['ESAVI-CLASSIF-001', 'ESAVI-CLASSIF-005A', 'ESAVI-CLASSIF-005B']);
        });

        it('reactivating an active one answers 409', async () => {
            const { id } = await classifyNewCase();

            const response = await activateClassification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_005B_ALREADY_ACTIVE');
        });

        it('an ADMIN gets 403 on activate', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const response = await activateClassification(id, 'ADMIN');

            expect(response.status).toBe(403);
        });

        it('reactivating does not require the case to be active', async () => {
            const { id, caseId } = await classifyNewCase();
            await deleteClassification(id);
            await EsaviCase.update({ isActive: false }, { where: { caseId } });

            const response = await activateClassification(id);

            expect(response.status).toBe(200);
        });

        it('answers 404 for an unknown id', async () => {
            const response = await deleteClassification(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_005A_NOT_FOUND');
        });

    });

    describe('ESAVI-CLASSIF-005C — purge', () => {

        it('answers 409 on an active classification and the row survives', async () => {
            const { id } = await classifyNewCase();

            const response = await purgeClassification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CLASSIF_005C_STILL_ACTIVE');
            expect(await Classification.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('destroys an inactive one and answers 200 without data', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const response = await purgeClassification(id);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(await Classification.findByPk(id, { paranoid: false })).toBeNull();
        });

        it('answers 404 when the purge is repeated', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);
            await purgeClassification(id);

            const response = await purgeClassification(id);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CLASSIF_005C_NOT_FOUND');
        });

        it('an ADMIN gets 403', async () => {
            const { id } = await classifyNewCase();
            await deleteClassification(id);

            const response = await purgeClassification(id, 'ADMIN');

            expect(response.status).toBe(403);
            expect(await Classification.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('releases the caseId, which is the only way to get it back', async () => {
            const { id, caseId } = await classifyNewCase();
            await deleteClassification(id);

            const blocked = await createClassification({ caseId });
            await purgeClassification(id);
            const allowed = await createClassification({ caseId });

            expect(blocked.status).toBe(409);
            expect(allowed.status).toBe(201);
        });

        it('does not alter the case the classification belonged to', async () => {
            const { id, caseId } = await classifyNewCase();
            const before = await EsaviCase.findByPk(caseId);
            await deleteClassification(id);

            await purgeClassification(id);

            const after = await EsaviCase.findByPk(caseId);
            expect(after).not.toBeNull();
            expect(after!.getDataValue('caseCode')).toBe(before!.getDataValue('caseCode'));
            expect(after!.getDataValue('isActive')).toBe(true);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const caseId = await createCaseFixture();
            const created = await createClassification({
                caseId,
                firstConsultationDate: '2024-05-06',
                causedDeath: false,
                notes: 'Sin novedad'
            });
            expect(created.status).toBe(201);

            // The recomputed age is part of the comparison: it travels always, and here it
            // resolves to the same value already stored, so it is not a difference either
            await expectPutOfGetResponseWritesNothing({
                path: '/api/classifications',
                id: created.body.data.classificationId,
                model: Classification,
                // The response carries `age` and the resolved `ageUnit` object, but the
                // validator demands `age` and `ageUnitItemId` together, so resending the
                // response verbatim is a 400. The asymmetry belongs to SPEC F09, not here
                strip: ['age']
            });
        });

    });

    // -----------------------------------------------------------------------
    // SPEC F11 — the age propagated from ESAVI-CASE-004 and ESAVI-PATIENT-004 has to be
    // the very same one the manual route of SPEC F09 produces. Two implementations of the
    // calculation would diverge exactly at the borders where the number gets reviewed
    // -----------------------------------------------------------------------

    describe('age recalculation — SPEC F11', () => {

        it('propagates the same age a PUT over the classification itself would compute', async () => {
            // Two identical cases: same birthDate, same eventDate, same classification
            const propagatedCaseId = await createCaseFixture({ birthDate: '2000-05-04', eventDate: '2024-05-04' });
            const manualCaseId = await createCaseFixture({ birthDate: '2000-05-04', eventDate: '2024-05-04' });
            const propagated = await createClassification({ caseId: propagatedCaseId });
            const manual = await createClassification({ caseId: manualCaseId });
            expect(propagated.body.data.age).toBe(24);

            // A date deliberately near a border: the day before the birthday is one year less
            const corrected = '2018-05-03';

            // One case is corrected through its endpoint, which propagates
            const movedByCase = await request(app)
                .put(`/api/esavi-cases/${ propagatedCaseId }`)
                .set(authHeader('USER'))
                .send({ eventDate: corrected });
            expect(movedByCase.status).toBe(200);

            // The other one has its eventDate moved behind the API's back — which is the state
            // of every classification stored before this spec — and is then fixed by hand with
            // the route SPEC F09 left open: an empty PUT over the classification
            await EsaviCase.update({ eventDate: corrected }, { where: { caseId: manualCaseId } });
            const movedByHand = await updateClassification(manual.body.data.classificationId, {});
            expect(movedByHand.status).toBe(200);

            const afterPropagation = await getClassificationByCase(propagatedCaseId);
            expect(afterPropagation.body.data.age).toBe(17);
            expect(afterPropagation.body.data.age).toBe(movedByHand.body.data.age);
            expect(afterPropagation.body.data.ageUnit.catalogItemId).toBe(movedByHand.body.data.ageUnit.catalogItemId);

            // What does differ is who is recorded as having done it
            expect(afterPropagation.body.data.appDetails[1].method).toBe('ESAVI-CASE-004');
            expect(movedByHand.body.data.appDetails[1].method).toBe('ESAVI-CLASSIF-004');
        });

        it('propagates the unit too, not only the number', async () => {
            const caseId = await createCaseFixture({ birthDate: '2024-01-01', eventDate: '2024-05-04' });
            const created = await createClassification({ caseId });
            expect(created.body.data.age).toBe(4);
            expect(created.body.data.ageUnit.catalogItemId).toBe(monthsItemId);

            // Four months become eleven days: the unit changes with the number
            const moved = await request(app)
                .put(`/api/esavi-cases/${ caseId }`)
                .set(authHeader('USER'))
                .send({ eventDate: '2024-01-12' });
            expect(moved.status).toBe(200);

            const after = await getClassificationByCase(caseId);
            expect(after.body.data.age).toBe(11);
            expect(after.body.data.ageUnit.catalogItemId).toBe(daysItemId);
            expect(after.body.data.ageUnit.value).toBe('DAYS');
        });

    });

});
