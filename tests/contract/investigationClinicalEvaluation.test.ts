import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationAutopsy, InvestigationClinicalEvaluation, InvestigationMedicalHistory, InvestigationSource, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationClinicalEvaluation operations of SPEC F34. It walks
 * the entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the
 * logical seal does not release but the purge does, the three distinct 404 of the access by
 * case, and the three flag/explanation pairs evaluated over the resulting state.
 *
 * Three things separate this entity from its sisters F29, F30 and F32 and get deliberate
 * coverage:
 *
 *  - It is the FIRST satellite of investigation with an ENCRYPTED column.
 *    clinicalDetailsPersonName is stored as the esaviCrypt ciphertext of its title-cased,
 *    trimmed value, and the diff compares in CLEAR — esaviDecrypt over the stored value before
 *    it, esaviCrypt over the result after it. Two cases pin that down where it would break in
 *    silence: a PUT resending the name a GET returned must leave the column identical byte for
 *    byte, and the ciphertext must never reach an HTTP response nor the log.
 *  - It is the first table with THREE flag/explanation pairs governed by one rule. Each one is
 *    evaluated against its own resulting flag, produces its own error code and its own i18n key,
 *    and the three are independent. The comparison is always `=== true`, so false, null and
 *    absent all close the pair — a rule written against truthiness would pass the first two of
 *    those three by accident.
 *  - It has NO foreign key to catalogItem at all, so the only include of the entity is its
 *    parent, and that include is what implements the inherited visibility.
 *
 * The false gets deliberate coverage of its own on the six booleans: an `if( data.x )` in the
 * service would make it impossible to turn a source off — a valid state of the form — while
 * still answering 200.
 */
describe('investigationClinicalEvaluation contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const basePath = '/api/investigation-clinical-evaluations';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

    let statusZeroItemId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // Every fixture is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Evaluation ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CE${ counter }${ suffix }`),
            healthSystemCode: `CE${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `CE${ counter }${ suffix }`,
            name: `Evaluation ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CE-${ suffix }-${ counter }`,
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
        request(app).post(basePath).set(authHeader(role)).send(payload);

    // The empty create of this entity: { investigationId } is the whole minimum. Mints an
    // investigation and its clinical evaluation in one go
    const seed = async (payload: Record<string, unknown> = {}): Promise<string> => {
        const investigationId = await createInvestigationFixture();
        const res = await create({ investigationId, ...payload });
        expect(res.status).toBe(201);
        return investigationId;
    };

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`${ basePath }/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`${ basePath }${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`${ basePath }/admin${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    const readRow = async (id: string) => await InvestigationClinicalEvaluation.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationClinicalEvaluation.update({ deletedAt: at }, { where: { investigationId } });

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    // The three pairs, in the order FLAG_EXPLANATION_PAIRS declares them. That order is what
    // decides which 400 a body breaking two of them at once receives
    const flagPairs: [string, string, string][] = [
        ['sourceOther', 'otherDescription', 'OTHER_DESCRIPTION'],
        ['suspectedChildAbuse', 'childAbuseExplanation', 'CHILD_ABUSE_EXPLANATION'],
        ['suspectedDomesticViolence', 'domesticViolenceExplanation', 'DOMESTIC_VIOLENCE_EXPLANATION']
    ];

    const dataColumns = [
        'receivedMedicalAttention', 'sourceExam', 'sourceDocuments', 'sourceVerbalAutopsy',
        'sourceOther', 'otherDescription', 'suspectedChildAbuse', 'childAbuseExplanation',
        'suspectedDomesticViolence', 'domesticViolenceExplanation', 'clinicalDetailsPersonName',
        'familyClinicalDetails', 'completeClinicalSummary', 'signsAndSymptoms',
        'otherSocialBackground', 'notes'
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

        it('the empty create returns 201 with the sixteen data columns in null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            for( const column of dataColumns ) {
                expect(res.body.data[column]).toBeNull();
            }
            // The parent travels resolved, and its status never comes back null
            expect(res.body.data.investigation.investigationId).toBe(investigationId);
            expect(res.body.data.investigation.status).not.toBeNull();
            // The table has no isActive, and sysDetails never leaves the service
            expect(res.body.data.isActive).toBeUndefined();
            expect(res.body.data.sysDetails).toBeUndefined();
        });

        it('the audit entry carries the operation code', async () => {
            const id = await seed();
            const details = await appDetailsOf(id);
            expect(details).toHaveLength(1);
            expect(details[0].method).toBe('ESAVI-INVCLIEV-001');
        });

        it('a second create over the same investigation returns 409 with the id interpolated', async () => {
            const investigationId = await seed();
            const res = await create({ investigationId });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVCLIEV_001_ALREADY_EXISTS');
            expect(res.body.message).toContain(investigationId);
        });

        it('a sealed row still occupies the investigationId — the seal does not free the slot', async () => {
            const investigationId = await seed();
            await seal(investigationId);
            expect((await create({ investigationId })).status).toBe(409);
        });

        it('an inactive investigation returns 404, and an unknown one too', async () => {
            const investigationId = await createInvestigationFixture(false);
            const res = await create({ investigationId });

            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCLIEV_001_INVESTIGATION_NOT_FOUND');
            expect((await create({ investigationId: unknownUuid })).status).toBe(404);
        });

        it('a body with no investigationId is a 400 of the validator', async () => {
            expect((await create({})).status).toBe(400);
        });

        it('false is stored as false and never folded into null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, sourceExam: false, sourceDocuments: true });

            expect(res.body.data.sourceExam).toBe(false);
            expect(res.body.data.sourceDocuments).toBe(true);
            expect(res.body.data.sourceVerbalAutopsy).toBeNull();
        });

        it('receivedMedicalAttention keeps null and NO_ANSWER apart, and rejects anything else', async () => {
            const withAnswer = await createInvestigationFixture();
            expect((await create({ investigationId: withAnswer, receivedMedicalAttention: 'NO_ANSWER' })).body.data.receivedMedicalAttention)
                .toBe('NO_ANSWER');

            const withoutAnswer = await createInvestigationFixture();
            expect((await create({ investigationId: withoutAnswer })).body.data.receivedMedicalAttention).toBeNull();

            const invalid = await createInvestigationFixture();
            expect((await create({ investigationId: invalid, receivedMedicalAttention: 'MAYBE' })).status).toBe(400);
        });

        it('the seven free texts are trimmed, and a blank one is stored as null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, notes: '  a note  ', signsAndSymptoms: '   ' });

            expect(res.body.data.notes).toBe('a note');
            expect(res.body.data.signsAndSymptoms).toBeNull();
        });

        it.each(flagPairs)('%s true without its explanation is a 400', async (flag, explanation, key) => {
            const investigationId = await createInvestigationFixture();

            const missing = await create({ investigationId, [flag]: true });
            expect(missing.status).toBe(400);
            expect(missing.body.code).toBe(`INVCLIEV_001_${ key }_REQUIRED`);

            // A blank explanation is no explanation at all
            expect((await create({ investigationId, [flag]: true, [explanation]: '   ' })).status).toBe(400);

            // With content it goes through
            const ok = await create({ investigationId, [flag]: true, [explanation]: 'because' });
            expect(ok.status).toBe(201);
            expect(ok.body.data[explanation]).toBe('because');
        });

        it.each(flagPairs)('%s not true with an explanation is a 400 — the create is strict', async (flag, explanation, key) => {
            const investigationId = await createInvestigationFixture();

            const explicitFalse = await create({ investigationId, [flag]: false, [explanation]: 'x' });
            expect(explicitFalse.status).toBe(400);
            expect(explicitFalse.body.code).toBe(`INVCLIEV_001_${ key }_NOT_ALLOWED`);

            // null and absent close the pair exactly like false does
            expect((await create({ investigationId, [flag]: null, [explanation]: 'x' })).status).toBe(400);
            expect((await create({ investigationId, [explanation]: 'x' })).status).toBe(400);
        });

        it('a body breaking two pairs at once receives one 400, the first declared', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                sourceOther: false, otherDescription: 'x',
                suspectedChildAbuse: false, childAbuseExplanation: 'y'
            });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCLIEV_001_OTHER_DESCRIPTION_NOT_ALLOWED');
        });

        it('clinicalDetailsPersonName is stored as the ciphertext of its title-cased value', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, clinicalDetailsPersonName: '  juan carlos  ' });

            expect(res.status).toBe(201);
            // The response carries plain text and never a ciphertext
            expect(res.body.data.clinicalDetailsPersonName).toBe('Juan Carlos');
            // And the column holds the encryption of the normalized value, read without the service
            expect((await readRow(investigationId))!.getDataValue('clinicalDetailsPersonName'))
                .toBe(esaviCrypt('Juan Carlos'));
        });
    });

    describe('002A / 002B — the dual listing', () => {

        it('the public listing hides the evaluations of retired investigations and the admin one shows them', async () => {
            const visible = await seed({ notes: 'visible' });
            const hidden = await seed({ notes: 'hidden' });
            await retireInvestigation(hidden);

            const idsOf = (body: { data: { rows: { investigationId: string }[] } }) =>
                body.data.rows.map(row => row.investigationId);

            const publicRes = await list('?limit=100');
            expect(publicRes.status).toBe(200);
            expect(idsOf(publicRes.body)).toContain(visible);
            expect(idsOf(publicRes.body)).not.toContain(hidden);

            const adminRes = await listAdmin('?limit=100');
            expect(adminRes.status).toBe(200);
            expect(idsOf(adminRes.body)).toContain(hidden);
        });

        it('a USER gets 403 on the admin listing', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });

        it('the two filters apply by equality and accumulate with AND', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });
            const otherCaseId = await createCaseFixture();
            await createInvestigationForCase(otherCaseId);

            expect((await list(`?investigationId=${ investigationId }`)).body.data.count).toBe(1);
            expect((await list(`?caseId=${ caseId }`)).body.data.count).toBe(1);
            expect((await list(`?investigationId=${ investigationId }&caseId=${ caseId }`)).body.data.count).toBe(1);

            // Crossed: AND and not OR, so nothing matches
            expect((await list(`?investigationId=${ investigationId }&caseId=${ otherCaseId }`)).body.data.count).toBe(0);
        });

        it('a filter with an unknown UUID returns 200 with count 0, not 404', async () => {
            const res = await list(`?caseId=${ unknownUuid }`);
            expect(res.status).toBe(200);
            expect(res.body.data).toEqual({ count: 0, rows: [] });
        });

        it('a malformed filter or an out of range limit is a 400 of the validator', async () => {
            expect((await list('?caseId=not-a-uuid')).status).toBe(400);
            expect((await list('?limit=0')).status).toBe(400);
        });

        it('every row carries the full shape, and none carries isActive or sysDetails', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, notes: 'full shape' });

            const row = (await list(`?investigationId=${ investigationId }`)).body.data.rows[0];
            for( const column of dataColumns ) {
                expect(row).toHaveProperty(column);
            }
            expect(row).toHaveProperty('appDetails');
            expect(row).toHaveProperty('deletedAt');
            expect(row.isActive).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
            expect(row.investigation.sysDetails).toBeUndefined();
            expect(row.investigation.status).not.toBeNull();
            expect(row.investigation.case.caseId).toBe(caseId);
        });

        it('no row of either listing returns a ciphertext', async () => {
            const investigationId = await seed({ clinicalDetailsPersonName: 'ana lopez' });

            const publicRow = (await list(`?investigationId=${ investigationId }`)).body.data.rows[0];
            expect(publicRow.clinicalDetailsPersonName).toBe('Ana Lopez');
            expect(publicRow.clinicalDetailsPersonName).not.toBe(esaviCrypt('Ana Lopez'));

            const adminRow = (await listAdmin(`?investigationId=${ investigationId }`)).body.data.rows[0];
            expect(adminRow.clinicalDetailsPersonName).toBe('Ana Lopez');
        });

        it('limit bounds the page while count stays the total, ordered by createdAt DESC', async () => {
            await seed();
            await seed();

            const res = await listAdmin('?limit=2');
            expect(res.body.data.rows).toHaveLength(2);
            expect(res.body.data.count).toBeGreaterThanOrEqual(2);

            const dates = res.body.data.rows.map((row: { createdAt: string }) => new Date(row.createdAt).getTime());
            expect(dates[0]).toBeGreaterThanOrEqual(dates[1]);
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape with the parent resolved and no sysDetails anywhere', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, notes: 'a note', clinicalDetailsPersonName: 'ana lopez' });

            const res = await getById(investigationId);
            expect(res.status).toBe(200);
            for( const column of dataColumns ) {
                expect(res.body.data).toHaveProperty(column);
            }
            expect(res.body.data.investigation.status.code).toBeDefined();
            expect(res.body.data.investigation.case.caseId).toBe(caseId);
            expect(res.body.data.sysDetails).toBeUndefined();
            expect(res.body.data.investigation.sysDetails).toBeUndefined();
            expect(res.body.data.investigation.status.sysDetails).toBeUndefined();
            // Decrypted, in the only place a client can read it
            expect(res.body.data.clinicalDetailsPersonName).toBe('Ana Lopez');
        });

        it('an unknown ID returns 404 and a malformed one 400', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVCLIEV_003_NOT_FOUND');
            expect((await getById('not-a-uuid')).status).toBe(400);
        });

        it('a retired investigation hides the row from USER and ADMIN but not from SUPERADMIN', async () => {
            const id = await seed();
            await retireInvestigation(id);

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'ADMIN')).status).toBe(404);

            const superRes = await getById(id, 'SUPERADMIN');
            expect(superRes.status).toBe(200);
            expect(superRes.body.data.investigation.isActive).toBe(false);
        });

        it('a sealed row is still returned while its investigation is active', async () => {
            const id = await seed();
            await seal(id);

            const res = await getById(id);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });

        it('the literal paths are not captured as an :id', async () => {
            expect((await getById('admin', 'ADMIN')).status).toBe(200);
        });
    });

    describe('006 — get by case', () => {

        it('returns the record itself and not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId, clinicalDetailsPersonName: 'ana lopez' });

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(false);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.clinicalDetailsPersonName).toBe('Ana Lopez');
        });

        it('the three 404 are distinct from one another', async () => {
            const noCase = await getByCase(unknownUuid);
            expect(noCase.status).toBe(404);
            expect(noCase.body.code).toBe('INVCLIEV_006_CASE_NOT_FOUND');

            const noInvestigation = await getByCase(await createCaseFixture());
            expect(noInvestigation.status).toBe(404);
            expect(noInvestigation.body.code).toBe('INVCLIEV_006_INVESTIGATION_NOT_FOUND');

            const caseWithInvestigation = await createCaseFixture();
            await createInvestigationForCase(caseWithInvestigation);
            const noEvaluation = await getByCase(caseWithInvestigation);
            expect(noEvaluation.status).toBe(404);
            expect(noEvaluation.body.code).toBe('INVCLIEV_006_NOT_FOUND');

            expect(new Set([noCase.body.code, noInvestigation.body.code, noEvaluation.body.code]).size).toBe(3);
        });

        it('an inactive case answers caseNotFound even for SUPERADMIN', async () => {
            const caseId = await createCaseFixture(false);
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            expect((await getByCase(caseId, 'SUPERADMIN')).body.code).toBe('INVCLIEV_006_CASE_NOT_FOUND');
        });

        it('a retired investigation hides the chain from USER but not from SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });
            await retireInvestigation(investigationId);

            const userRes = await getByCase(caseId, 'USER');
            expect(userRes.status).toBe(404);
            expect(userRes.body.code).toBe('INVCLIEV_006_INVESTIGATION_NOT_FOUND');
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

        it('a malformed caseId is a 400 of the validator', async () => {
            expect((await getByCase('not-a-uuid')).status).toBe(400);
        });
    });

    describe('004 — update, differential', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const id = await seed({
                receivedMedicalAttention: 'NO_ANSWER',
                sourceExam: true, sourceDocuments: false,
                sourceOther: true, otherDescription: 'a source',
                suspectedChildAbuse: true, childAbuseExplanation: 'an explanation',
                clinicalDetailsPersonName: 'juan carlos',
                completeClinicalSummary: 'a summary', notes: 'a note'
            });

            await expectPutOfGetResponseWritesNothing({
                path: basePath, id, model: InvestigationClinicalEvaluation, role: 'USER'
            });
        });

        it('an empty body behaves the same', async () => {
            const id = await seed({ notes: 'stable' });
            const versionBefore = await versionOf(id);

            expect((await update(id, {})).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);
            expect(await appDetailsOf(id)).toHaveLength(1);
        });

        it('changing one field adds one entry and bumps the version by 1', async () => {
            const id = await seed();
            const versionBefore = await versionOf(id) ?? 0;

            const res = await update(id, { notes: 'changed' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('changed');
            expect(await versionOf(id)).toBe(versionBefore + 1);

            const details = await appDetailsOf(id);
            expect(details).toHaveLength(2);
            expect(details[1].method).toBe('ESAVI-INVCLIEV-004');
        });

        it('false is stored and null empties the field — no candidate under an if( data.x )', async () => {
            const id = await seed({ sourceExam: true });

            expect((await update(id, { sourceExam: false })).body.data.sourceExam).toBe(false);
            expect((await readRow(id))!.getDataValue('sourceExam')).toBe(false);
            expect((await update(id, { sourceExam: null })).body.data.sourceExam).toBeNull();
        });

        it('null and NO_ANSWER stay apart on receivedMedicalAttention', async () => {
            const id = await seed({ receivedMedicalAttention: 'NO_ANSWER' });
            const versionBefore = await versionOf(id);

            // Resending the same value is not a change
            await update(id, { receivedMedicalAttention: 'NO_ANSWER' });
            expect(await versionOf(id)).toBe(versionBefore);

            // null empties it, and that IS a change
            expect((await update(id, { receivedMedicalAttention: null })).body.data.receivedMedicalAttention).toBeNull();
            expect(await versionOf(id)).not.toBe(versionBefore);
        });

        it('investigationId is ignored, without a 400', async () => {
            const id = await seed();
            const other = await createInvestigationFixture();

            const res = await update(id, { investigationId: other });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(id);
            expect(await readRow(other)).toBeNull();
        });

        it('trimming happens before comparing', async () => {
            const id = await seed({ notes: 'a note' });
            const versionBefore = await versionOf(id);

            await update(id, { notes: '   a note   ' });
            expect(await versionOf(id)).toBe(versionBefore);

            expect((await update(id, { notes: '' })).body.data.notes).toBeNull();
        });

        it('a retired investigation answers 404 for USER and ADMIN and 200 for SUPERADMIN', async () => {
            const id = await seed();
            await retireInvestigation(id);

            expect((await update(id, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await update(id, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
        });

        it('an unknown id is a 404 and a malformed one a 400', async () => {
            const notFound = await update(unknownUuid, { notes: 'x' });
            expect(notFound.status).toBe(404);
            expect(notFound.body.code).toBe('INVCLIEV_004_NOT_FOUND');
            expect((await update('not-a-uuid', { notes: 'x' })).status).toBe(400);
        });

        it.each(flagPairs)('%s — the resulting state rules, not the body', async (flag, explanation, key) => {
            const id = await seed({ [flag]: true, [explanation]: 'a reason' });

            // Only the flag, over a row that already carries its explanation: valid
            expect((await update(id, { [flag]: true })).status).toBe(200);

            // Turning it off clears the explanation in the SAME request, with ONE appDetails entry
            const before = (await appDetailsOf(id)).length;
            const off = await update(id, { [flag]: false });
            expect(off.status).toBe(200);
            expect(off.body.data[explanation]).toBeNull();
            expect(await appDetailsOf(id)).toHaveLength(before + 1);

            // Turning off an already off pair with no explanation writes NOTHING
            const versionBefore = await versionOf(id);
            expect((await update(id, { [flag]: false })).status).toBe(200);
            expect(await versionOf(id)).toBe(versionBefore);

            // A body denying the flag and explaining it at the same time is a 400
            const contradiction = await update(id, { [flag]: false, [explanation]: 'x' });
            expect(contradiction.status).toBe(400);
            expect(contradiction.body.code).toBe(`INVCLIEV_004_${ key }_NOT_ALLOWED`);

            // Sending it as null is NOT an error: it is where the forcing lands on its own
            expect((await update(id, { [flag]: false, [explanation]: null })).status).toBe(200);

            // Turning it on with no explanation stored is a 400
            const required = await update(id, { [flag]: true });
            expect(required.status).toBe(400);
            expect(required.body.code).toBe(`INVCLIEV_004_${ key }_REQUIRED`);
        });

        it('the three pairs are independent: turning one off does not touch the others', async () => {
            const id = await seed({
                sourceOther: true, otherDescription: 'a source',
                suspectedChildAbuse: true, childAbuseExplanation: 'abuse',
                suspectedDomesticViolence: true, domesticViolenceExplanation: 'violence'
            });

            const res = await update(id, { sourceOther: false });
            expect(res.status).toBe(200);
            expect(res.body.data.otherDescription).toBeNull();
            expect(res.body.data.childAbuseExplanation).toBe('abuse');
            expect(res.body.data.domesticViolenceExplanation).toBe('violence');
        });

        it('a body breaking two pairs at once receives one 400, the first declared', async () => {
            const id = await seed();
            const res = await update(id, {
                sourceOther: false, otherDescription: 'x',
                suspectedChildAbuse: false, childAbuseExplanation: 'y'
            });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVCLIEV_004_OTHER_DESCRIPTION_NOT_ALLOWED');
        });

        it('resending the stored name leaves the ciphertext identical byte for byte', async () => {
            const id = await seed({ clinicalDetailsPersonName: 'juan carlos' });
            const cipherBefore = (await readRow(id))!.getDataValue('clinicalDetailsPersonName');
            const versionBefore = await versionOf(id);

            // What the GET returned, resent verbatim
            expect((await update(id, { clinicalDetailsPersonName: 'Juan Carlos' })).status).toBe(200);
            expect((await readRow(id))!.getDataValue('clinicalDetailsPersonName')).toBe(cipherBefore);
            expect(await versionOf(id)).toBe(versionBefore);

            // And the un-normalized form is not a change either: toTitleCase runs before comparing
            await update(id, { clinicalDetailsPersonName: '  juan carlos  ' });
            expect(await versionOf(id)).toBe(versionBefore);
        });

        it('a real change is encrypted after the diff, and a null is written as null', async () => {
            const id = await seed({ clinicalDetailsPersonName: 'juan carlos' });

            const changed = await update(id, { clinicalDetailsPersonName: 'ana lopez' });
            expect(changed.body.data.clinicalDetailsPersonName).toBe('Ana Lopez');
            expect((await readRow(id))!.getDataValue('clinicalDetailsPersonName')).toBe(esaviCrypt('Ana Lopez'));

            // Never the encryption of the empty string
            expect((await update(id, { clinicalDetailsPersonName: null })).body.data.clinicalDetailsPersonName).toBeNull();
            expect((await readRow(id))!.getDataValue('clinicalDetailsPersonName')).toBeNull();
        });
    });

    describe('005C — purge', () => {

        it('purging a row that was never sealed returns 409 and leaves it there', async () => {
            const id = await seed();

            const res = await purge(id);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVCLIEV_005C_NOT_DELETED');
            expect(res.body.message).toContain(id);

            // This is what proves the isActive guard of purgeEntityService would be inert here
            expect(await readRow(id)).not.toBeNull();
        });

        it('a sealed row is destroyed, answers without data, and repeating gives 404', async () => {
            const id = await seed({ notes: 'about to go' });
            await seal(id);

            const res = await purge(id);
            expect(res.status).toBe(200);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(id)).toBeNull();

            const again = await purge(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('INVCLIEV_005C_NOT_FOUND');
        });

        it('an ADMIN gets 403 and an unknown id 404', async () => {
            const id = await seed();
            await seal(id);

            expect((await purge(id, 'ADMIN')).status).toBe(403);
            expect((await purge(unknownUuid)).status).toBe(404);
        });

        it('purging releases the investigationId — a POST over it answers 201 again', async () => {
            const id = await seed();
            await seal(id);
            expect((await create({ investigationId: id })).status).toBe(409);

            await purge(id);
            expect((await create({ investigationId: id })).status).toBe(201);
        });

        it('the investigation and its other satellites survive', async () => {
            const id = await seed();
            await InvestigationMedicalHistory.create({ investigationId: id, notes: 'sibling' });
            await seal(id);

            expect((await purge(id)).status).toBe(200);
            expect(await Investigation.findByPk(id)).not.toBeNull();
            expect(await InvestigationMedicalHistory.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('the warn dump carries the row but never clinicalDetailsPersonName', async () => {
            const id = await seed({ clinicalDetailsPersonName: 'juan carlos', notes: 'dumped' });
            await seal(id);
            expect((await purge(id)).status).toBe(200);

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));

            const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8') : '';
            const purgeLines = log.split('\n').filter(line => line.includes('ESAVI-INVCLIEV-005C') && line.includes(id));
            expect(purgeLines.length).toBeGreaterThan(0);

            for( const line of purgeLines ) {
                expect(line).not.toContain('clinicalDetailsPersonName');
                expect(line).not.toContain('Juan Carlos');
                expect(line).not.toContain(esaviCrypt('Juan Carlos'));
            }
            expect(purgeLines.some(line => line.includes('dumped'))).toBe(true);
        });
    });

    describe('the three cascades', () => {

        const deactivateInvestigation = (id: string) =>
            request(app).delete(`/api/investigations/${ id }`).set(authHeader('ADMIN'));

        const activateInvestigation = (id: string) =>
            request(app).patch(`/api/investigations/activate/${ id }`).set(authHeader('SUPERADMIN'));

        const deactivateCase = (caseId: string) =>
            request(app).delete(`/api/esavi-cases/${ caseId }`).set(authHeader('ADMIN'));

        const activateCase = (caseId: string) =>
            request(app).patch(`/api/esavi-cases/activate/${ caseId }`).set(authHeader('SUPERADMIN'));

        it('ESAVI-INVESTGN-005A seals the evaluation and 005B returns it, each with its own method', async () => {
            const id = await seed({ notes: 'dragged' });

            expect((await deactivateInvestigation(id)).status).toBe(200);
            expect((await readRow(id))!.getDataValue('deletedAt')).not.toBeNull();

            expect((await activateInvestigation(id)).status).toBe(200);
            expect((await readRow(id))!.getDataValue('deletedAt')).toBeNull();

            expect((await appDetailsOf(id)).map(entry => entry.method))
                .toEqual(['ESAVI-INVCLIEV-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B']);
        });

        it('ESAVI-CASE-005A seals it too, and ESAVI-CASE-005B does not clear it', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            await create({ investigationId });

            // The point of the drag: the mass Investigation.update does not go through
            // setInvestigationActivationService, so without it the row would stay unsealed
            expect((await deactivateCase(caseId)).status).toBe(200);
            const sealedAt = (await readRow(investigationId))!.getDataValue('deletedAt');
            expect(sealedAt).not.toBeNull();

            expect((await appDetailsOf(investigationId)).map(entry => entry.method))
                .toEqual(['ESAVI-INVCLIEV-001', 'ESAVI-CASE-005A']);

            expect((await activateCase(caseId)).status).toBe(200);
            expect((await readRow(investigationId))!.getDataValue('deletedAt')).toEqual(sealedAt);
        });

        it('a row already sealed keeps its date and receives no new entry', async () => {
            const id = await seed();
            const sealedAt = new Date('2025-01-15T10:00:00.000Z');
            await seal(id, sealedAt);
            const before = (await appDetailsOf(id)).length;

            await deactivateInvestigation(id);

            expect((await readRow(id))!.getDataValue('deletedAt')).toEqual(sealedAt);
            expect(await appDetailsOf(id)).toHaveLength(before);
        });

        it('an investigation with no evaluation deactivates and reactivates without error', async () => {
            const id = await createInvestigationFixture();
            expect((await deactivateInvestigation(id)).status).toBe(200);
            expect((await activateInvestigation(id)).status).toBe(200);
        });

        it('the four satellites without isActive are sealed and returned together', async () => {
            const id = await seed();
            await InvestigationSource.create({ investigationId: id });
            await InvestigationAutopsy.create({ investigationId: id, isDeath: false });
            await InvestigationMedicalHistory.create({ investigationId: id });

            const satellites = [InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory, InvestigationClinicalEvaluation];

            await deactivateInvestigation(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activateInvestigation(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });

        it('purging the investigation destroys the evaluation by Postgres cascade, dumping it without the encrypted column', async () => {
            const id = await seed({ clinicalDetailsPersonName: 'juan carlos', notes: 'cascade dump' });
            await deactivateInvestigation(id);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

            const res = await request(app).delete(`/api/investigations/purge/${ id }`).set(authHeader('SUPERADMIN'));
            expect(res.status).toBe(200);
            expect(await readRow(id)).toBeNull();

            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
            const evaluationLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('clinical evaluation'));

            expect(evaluationLine).toBeDefined();
            expect(evaluationLine).toContain('cascade dump');
            expect(evaluationLine).not.toContain('clinicalDetailsPersonName');
            expect(evaluationLine).not.toContain('Juan Carlos');
            expect(evaluationLine).not.toContain(esaviCrypt('Juan Carlos'));
        });
    });
});
