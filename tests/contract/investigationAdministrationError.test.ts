import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Investigation, InvestigationAdministrationError, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven investigationAdministrationError operations of SPEC F39. It walks
 * the entity end to end and covers what cannot be checked by hand reliably: the inherited
 * visibility of a table with no isActive column of its own, the one to one slot that the logical
 * seal does not release but the purge does, the three distinct 404 of the access by case, and the
 * rules of the syringe block evaluated over the resulting state.
 *
 * Four things separate this entity from its sisters and get deliberate coverage:
 *
 *  - IT IS THE FIRST BLOCK OF THE REPOSITORY THAT OPENS WITH THE NEGATIVE ANSWER. Only
 *    usedAutoDisableSyringes === 'NO' opens it; 'YES', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'
 *    and null close it alike. An implementation that copies F34, F36 or F38 and writes === 'YES'
 *    passes every other case of the block, so the polarity gets cases of its own — sending a
 *    closing flag together with a syringe type and expecting 400 is the only thing that breaks
 *    under the inversion.
 *  - IT IS THE FIRST MINIMUM RULE OF THE REPOSITORY. With the block open at least one of the four
 *    syringe types must RESULT true. Evaluated over the resulting state and not over the body, so
 *    a PUT { notes } over a row already populated does not fail; a PUT that turns off the last
 *    true does.
 *  - IT IS THE FIRST NESTED BLOCK OF THE REPOSITORY, resolved as TWO SUCCESSIVE PASSES and not as
 *    one composite condition. The two passes return DIFFERENT error codes, and the case that
 *    sends the description with the OUTER block closed — expecting the outer code and not the
 *    nested one — is what breaks if somebody collapses them.
 *  - THE SIX had* / *Notes PAIRS ARE NOT CONDITIONAL BLOCKS. They look exactly like six, which is
 *    the most plausible change a future maintainer would make. The six cases that store each note
 *    with its flag at 'NO' are the only net that stops it, and a conditional block breaks all six
 *    at once.
 *
 * The false gets deliberate coverage of its own on the four boolean columns: a truthiness check
 * in the service would throw it away, and "syringes were used, but not glass ones" would become
 * inexpressible. The asymmetry of the create and the update over that false — 400 on 001, allowed
 * on 004 so the block can be closed in the same request that turns off its last type — is checked
 * on both sides.
 */
describe('investigationAdministrationError contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const basePath = '/api/investigation-administration-errors';
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
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
            firstName: esaviCrypt(`Admin ${ counter }`),
            lastName: esaviCrypt(`Error ${ suffix }`),
            documentNumber: esaviCrypt(`AE${ counter }${ suffix }`),
            healthSystemCode: `AE${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `AE${ counter }${ suffix }`,
            name: `Admin ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `AE-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    // statusItemId is passed explicitly: an investigation created straight through the model
    // skips the service of F28 that resolves the default status
    const createInvestigationForCase = async (caseId: string, isActive: boolean = true): Promise<string> =>
        (await Investigation.create({ caseId, statusItemId: statusZeroItemId, isActive }))
            .getDataValue('investigationId');

    const createInvestigationFixture = async (isActive: boolean = true): Promise<string> =>
        await createInvestigationForCase(await createCaseFixture(), isActive);

    const create = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    // The empty create of this entity: { investigationId } is the whole minimum. Mints an
    // investigation and its administration error in one go
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

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const readRow = async (id: string) =>
        await InvestigationAdministrationError.findByPk(id, { paranoid: false });

    const versionOf = async (id: string) =>
        ((await readRow(id))!.getDataValue('sysDetails') as { version?: number } | null)?.version;

    const appDetailsOf = async (id: string): Promise<{ method: string }[]> =>
        ((await readRow(id))!.getDataValue('appDetails') as { method: string }[]) ?? [];

    const deletedAtOf = async (id: string) => (await readRow(id))!.getDataValue('deletedAt');

    const retireInvestigation = (investigationId: string) =>
        Investigation.update({ isActive: false }, { where: { investigationId } });

    const seal = (investigationId: string, at: Date = new Date()) =>
        InvestigationAdministrationError.update({ deletedAt: at }, { where: { investigationId } });

    // The twenty six data columns of the DDL, all nullable and none of them required
    const dataColumns = [
        'usedAutoDisableSyringes', 'usedGlassSyringes', 'usedDisposableSyringes',
        'usedRecycledDisposableSyringes', 'usedOtherSyringes', 'otherSyringesDescription',
        'syringesKeyFindings', 'reconstitutionUsedSameSyringe',
        'reconstitutionUsedSameSyringeDifferentVaccine', 'reconstitutionUsedDifferentSyringeSameVial',
        'reconstitutionUsedDifferentSyringeDifferentVaccine',
        'reconstitutionFollowedManufacturerRecommendation', 'reconstitutionKeyFindings',
        'hadPrescriptionError', 'prescriptionErrorNotes', 'hadContaminatedVaccine',
        'contaminatedVaccineNotes', 'hadAbnormalVaccineConditions', 'abnormalConditionsNotes',
        'hadPreparationError', 'preparationErrorNotes', 'hadHandlingError', 'handlingErrorNotes',
        'hadImproperAdministration', 'improperAdministrationNotes', 'notes'
    ];

    // The four syringe types of the block. The order means nothing here — unlike the container
    // list of F38, where it was the precedence
    const syringeTypes = [
        'usedGlassSyringes', 'usedDisposableSyringes',
        'usedRecycledDisposableSyringes', 'usedOtherSyringes'
    ];

    // The whole block the flag governs
    const blockFields = [...syringeTypes, 'otherSyringesDescription'];

    // The six had* / *Notes pairs. Not one of them is a conditional block
    const errorPairs: [string, string][] = [
        ['hadPrescriptionError', 'prescriptionErrorNotes'],
        ['hadContaminatedVaccine', 'contaminatedVaccineNotes'],
        ['hadAbnormalVaccineConditions', 'abnormalConditionsNotes'],
        ['hadPreparationError', 'preparationErrorNotes'],
        ['hadHandlingError', 'handlingErrorNotes'],
        ['hadImproperAdministration', 'improperAdministrationNotes']
    ];

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        const type = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        const item = await CatalogItem.findOne({
            where: { catalogTypeId: type!.getDataValue('catalogTypeId'), code: '0' }
        });
        statusZeroItemId = item!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('the empty create returns 201 with the twenty six data columns in null', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId });

            expect(res.status).toBe(201);
            expect(res.body.ok).toBe(true);
            for( const column of dataColumns ) {
                expect(res.body.data[column]).toBeNull();
            }
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.deletedAt).toBeNull();
            expect((await appDetailsOf(investigationId))[0].method).toBe('ESAVI-INVADMER-001');
        });

        it('neither sysDetails nor isActive travel in the response', async () => {
            const investigationId = await seed();
            const res = await getById(investigationId);

            expect(res.body.data.sysDetails).toBeUndefined();
            expect(res.body.data.isActive).toBeUndefined();
            expect(res.body.data.investigation.sysDetails).toBeUndefined();
        });

        it('a second administration error over the same investigation is 409', async () => {
            const investigationId = await seed();
            const res = await create({ investigationId });

            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVADMER_001_ALREADY_EXISTS');
            expect(res.body.message).toContain(investigationId);
        });

        it('a sealed row still occupies the slot: the 409 survives the logical seal', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await create({ investigationId });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVADMER_001_ALREADY_EXISTS');
        });

        it('an inactive or unknown investigation is 404', async () => {
            const inactive = await createInvestigationFixture(false);
            const first = await create({ investigationId: inactive });
            expect(first.status).toBe(404);
            expect(first.body.code).toBe('INVADMER_001_INVESTIGATION_NOT_FOUND');

            const second = await create({ investigationId: unknownUuid });
            expect(second.status).toBe(404);
            expect(second.body.code).toBe('INVADMER_001_INVESTIGATION_NOT_FOUND');
        });

        it('a missing or malformed investigationId is 400', async () => {
            expect((await create({})).status).toBe(400);
            expect((await create({ investigationId: 'not-a-uuid' })).status).toBe(400);
        });

        it('the ten free texts are trimmed and a blank one is stored as null', async () => {
            const investigationId = await seed({
                notes: '  observacion general  ',
                syringesKeyFindings: '   ',
                reconstitutionKeyFindings: '  hallazgo  '
            });
            const res = await getById(investigationId);

            expect(res.body.data.notes).toBe('observacion general');
            expect(res.body.data.syringesKeyFindings).toBeNull();
            expect(res.body.data.reconstitutionKeyFindings).toBe('hallazgo');
        });

        it('a text of 5000 characters is stored: none of the ten columns is capped', async () => {
            const investigationId = await seed({ notes: 'x'.repeat(5000) });
            expect((await getById(investigationId)).body.data.notes).toHaveLength(5000);
        });
    });

    describe('001 — the polarity of the syringe block', () => {

        // The single case that an inverted condition breaks, and the reason it has four siblings
        // below: with === 'YES' written by mistake, everything else about the block keeps passing
        it("'YES' CLOSES the block: sending a syringe type with it is 400", async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                usedAutoDisableSyringes: 'YES',
                usedGlassSyringes: true
            });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it.each(['UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'])(
            "'%s' closes the block just the same",
            async (flag) => {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    usedAutoDisableSyringes: flag,
                    usedGlassSyringes: true
                });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED');
            }
        );

        it('an absent flag closes it too: null is the fifth closing state', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, usedDisposableSyringes: true });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it("'NO' OPENS it: a syringe type travels with it and the create is 201", async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true
            });

            expect(res.status).toBe(201);
            expect(res.body.data.usedAutoDisableSyringes).toBe('NO');
            expect(res.body.data.usedGlassSyringes).toBe(true);
        });

        it('false counts as a value in the create: sending it with the block closed is 400', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, usedGlassSyringes: false });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it('sending a block field as null is never an offence', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                usedGlassSyringes: null,
                otherSyringesDescription: null
            });

            expect(res.status).toBe(201);
            expect(res.body.data.usedGlassSyringes).toBeNull();
        });
    });

    describe('001 — the minimum rule', () => {

        it('opening the block and leaving it empty is 400', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, usedAutoDisableSyringes: 'NO' });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_TYPE_REQUIRED');
        });

        it('the four types in false is the same 400: false is no declaration', async () => {
            const investigationId = await createInvestigationFixture();
            const payload: Record<string, unknown> = { investigationId, usedAutoDisableSyringes: 'NO' };
            for( const field of syringeTypes ) payload[field] = false;

            const res = await create(payload);
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_TYPE_REQUIRED');
        });

        it.each(['usedGlassSyringes', 'usedDisposableSyringes', 'usedRecycledDisposableSyringes', 'usedOtherSyringes'])(
            'any one of the four satisfies the minimum: %s',
            async (field) => {
                const investigationId = await createInvestigationFixture();
                const res = await create({ investigationId, usedAutoDisableSyringes: 'NO', [field]: true });

                expect(res.status).toBe(201);
                expect(res.body.data[field]).toBe(true);
            }
        );

        it('the minimum does not reach the empty create: a null flag closes the block', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId })).status).toBe(201);
        });
    });

    describe('001 — the nested block of the description', () => {

        it('with the outer block open and usedOtherSyringes true the description is stored', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                usedAutoDisableSyringes: 'NO',
                usedOtherSyringes: true,
                otherSyringesDescription: '  de bisel corto  '
            });

            expect(res.status).toBe(201);
            expect(res.body.data.otherSyringesDescription).toBe('de bisel corto');
        });

        it.each([false, null])(
            'with the outer block open and usedOtherSyringes %s the description is 400',
            async (value) => {
                const investigationId = await createInvestigationFixture();
                const res = await create({
                    investigationId,
                    usedAutoDisableSyringes: 'NO',
                    usedDisposableSyringes: true,
                    usedOtherSyringes: value,
                    otherSyringesDescription: 'de bisel corto'
                });

                expect(res.status).toBe(400);
                expect(res.body.code).toBe('INVADMER_001_OTHER_DESCRIPTION_NOT_ALLOWED');
            }
        );

        // THE CASE THAT BREAKS IF THE TWO PASSES ARE COLLAPSED INTO ONE COMPOSITE CONDITION: with
        // the OUTER block closed the answer is the outer code and never the nested one, because
        // "you did not open the block" and "you did not declare other syringes" are two different
        // corrections of the form
        it('with the OUTER block closed the code is the outer one, not the nested one', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({ investigationId, otherSyringesDescription: 'de bisel corto' });

            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_001_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it('the description is never required: usedOtherSyringes true without it is 201', async () => {
            const investigationId = await createInvestigationFixture();
            const res = await create({
                investigationId,
                usedAutoDisableSyringes: 'NO',
                usedOtherSyringes: true
            });

            expect(res.status).toBe(201);
            expect(res.body.data.otherSyringesDescription).toBeNull();
        });
    });

    describe('001 — the three groups with no rules', () => {

        // Six cases, one per pair. A conditional block hung on the flags breaks all six at once,
        // which is exactly why they are written one by one
        it.each([
            ['hadPrescriptionError', 'prescriptionErrorNotes'],
            ['hadContaminatedVaccine', 'contaminatedVaccineNotes'],
            ['hadAbnormalVaccineConditions', 'abnormalConditionsNotes'],
            ['hadPreparationError', 'preparationErrorNotes'],
            ['hadHandlingError', 'handlingErrorNotes'],
            ['hadImproperAdministration', 'improperAdministrationNotes']
        ])("%s at 'NO' does not empty %s", async (flag, note) => {
            const investigationId = await seed({ [flag]: 'NO', [note]: 'el motivo de la respuesta' });
            const res = await getById(investigationId);

            expect(res.body.data[flag]).toBe('NO');
            expect(res.body.data[note]).toBe('el motivo de la respuesta');
        });

        it('a note is stored with its flag in null', async () => {
            const investigationId = await seed({ handlingErrorNotes: 'comentario suelto' });
            const res = await getById(investigationId);

            expect(res.body.data.hadHandlingError).toBeNull();
            expect(res.body.data.handlingErrorNotes).toBe('comentario suelto');
        });

        it("the five reconstitution columns are stored all in 'YES' at once", async () => {
            const investigationId = await seed({
                reconstitutionUsedSameSyringe: 'YES',
                reconstitutionUsedSameSyringeDifferentVaccine: 'YES',
                reconstitutionUsedDifferentSyringeSameVial: 'YES',
                reconstitutionUsedDifferentSyringeDifferentVaccine: 'YES',
                reconstitutionFollowedManufacturerRecommendation: 'YES'
            });
            const res = await getById(investigationId);

            expect(res.body.data.reconstitutionUsedSameSyringe).toBe('YES');
            expect(res.body.data.reconstitutionUsedSameSyringeDifferentVaccine).toBe('YES');
            expect(res.body.data.reconstitutionUsedDifferentSyringeSameVial).toBe('YES');
            expect(res.body.data.reconstitutionUsedDifferentSyringeDifferentVaccine).toBe('YES');
            expect(res.body.data.reconstitutionFollowedManufacturerRecommendation).toBe('YES');
        });

        it('syringesKeyFindings is outside the block: it is stored with the block closed', async () => {
            const investigationId = await seed({ syringesKeyFindings: 'jeringas sin lote' });
            expect((await getById(investigationId)).body.data.syringesKeyFindings).toBe('jeringas sin lote');
        });
    });

    describe('001 — the shape checked by the validator', () => {

        it('a value outside ANSWER_OPTIONS is 400', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, hadHandlingError: 'MAYBE' })).status).toBe(400);
        });

        it('a string sent to a boolean column is 400', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, usedGlassSyringes: 'yes' })).status).toBe(400);
        });

        it('a boolean sent to an answerOption column is 400', async () => {
            const investigationId = await createInvestigationFixture();
            expect((await create({ investigationId, hadPrescriptionError: true })).status).toBe(400);
        });
    });

    describe('002A / 002B — the dual listing', () => {

        it('a row of a retired investigation is absent from GET / and present in GET /admin', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            const publicRes = await list(`?investigationId=${ investigationId }`);
            expect(publicRes.status).toBe(200);
            expect(publicRes.body.data).toEqual({ count: 0, rows: [] });

            const adminRes = await listAdmin(`?investigationId=${ investigationId }`);
            expect(adminRes.status).toBe(200);
            expect(adminRes.body.data.count).toBe(1);
            expect(adminRes.body.data.rows[0].investigation.isActive).toBe(false);
        });

        it('the rows carry the same full shape as the 003', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);

            const row = (await list(`?investigationId=${ investigationId }`)).body.data.rows[0];
            for( const column of dataColumns ) expect(row).toHaveProperty(column);
            expect(row.investigation).toEqual({ investigationId, caseId, isActive: true });
            expect(row.sysDetails).toBeUndefined();
            expect(row.isActive).toBeUndefined();
        });

        it('the two filters are accumulative with AND', async () => {
            const caseA = await createCaseFixture();
            const investigationA = await createInvestigationForCase(caseA);
            expect((await create({ investigationId: investigationA })).status).toBe(201);

            const caseB = await createCaseFixture();
            const investigationB = await createInvestigationForCase(caseB);
            expect((await create({ investigationId: investigationB })).status).toBe(201);

            expect((await list(`?caseId=${ caseA }`)).body.data.count).toBe(1);
            expect((await list(`?investigationId=${ investigationA }&caseId=${ caseA }`)).body.data.count).toBe(1);
            // The crossed pair matches nothing: the two conditions accumulate
            expect((await list(`?investigationId=${ investigationA }&caseId=${ caseB }`)).body.data.count).toBe(0);
        });

        it('a filter whose UUID matches nothing is 200 with an empty listing, not 404', async () => {
            expect((await list(`?caseId=${ unknownUuid }`)).body.data).toEqual({ count: 0, rows: [] });
            expect((await listAdmin(`?investigationId=${ unknownUuid }`)).body.data).toEqual({ count: 0, rows: [] });
        });

        it('a malformed filter is 400', async () => {
            expect((await list('?investigationId=not-a-uuid')).status).toBe(400);
        });

        it('the order is createdAt DESC', async () => {
            await seed();
            await seed();

            const rows = (await list('?limit=10')).body.data.rows as { createdAt: string }[];
            const times = rows.map(row => new Date(row.createdAt).getTime());
            expect([...times].sort((a, b) => b - a)).toEqual(times);
        });

        it('/admin is declared before /:id and is closed to a USER', async () => {
            expect((await listAdmin('', 'USER')).status).toBe(403);
        });
    });

    describe('003 — get by ID', () => {

        it('returns the full shape, and the investigation narrowed to three fields', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);

            const res = await getById(investigationId);
            expect(res.status).toBe(200);
            for( const column of dataColumns ) expect(res.body.data).toHaveProperty(column);
            expect(res.body.data.createdAt).toBeDefined();
            expect(res.body.data.deletedAt).toBeNull();
            expect(res.body.data.appDetails).toHaveLength(1);
            expect(res.body.data.investigation).toEqual({ investigationId, caseId, isActive: true });
        });

        it('an unknown id is 404 and a malformed one is 400', async () => {
            const res = await getById(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_003_NOT_FOUND');

            expect((await getById('not-a-uuid')).status).toBe(400);
        });

        it('a retired investigation: 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await getById(investigationId, 'USER')).status).toBe(404);
            expect((await getById(investigationId, 'ADMIN')).status).toBe(404);

            const superRes = await getById(investigationId, 'SUPERADMIN');
            expect(superRes.status).toBe(200);
            expect(superRes.body.data.investigation.isActive).toBe(false);
        });

        it('a sealed deletedAt does not hide the row from whoever sees its investigation', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await getById(investigationId);
            expect(res.status).toBe(200);
            expect(res.body.data.deletedAt).not.toBeNull();
        });
    });

    describe('006 — get by case', () => {

        it('walks the two hops and answers with the object, not { count, rows }', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId, notes: 'por caso' })).status).toBe(201);

            const res = await getByCase(caseId);
            expect(res.status).toBe(200);
            expect(res.body.data.count).toBeUndefined();
            expect(res.body.data.rows).toBeUndefined();
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(res.body.data.notes).toBe('por caso');
        });

        it('an unknown case is 404 CASE_NOT_FOUND', async () => {
            const res = await getByCase(unknownUuid);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_006_CASE_NOT_FOUND');
        });

        it('an inactive case is the same 404 CASE_NOT_FOUND', async () => {
            const res = await getByCase(await createCaseFixture(false));
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_006_CASE_NOT_FOUND');
        });

        it('a case with no investigation is 404 INVESTIGATION_NOT_FOUND', async () => {
            const res = await getByCase(await createCaseFixture());
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_006_INVESTIGATION_NOT_FOUND');
        });

        it('an investigation with no administration error is 404 NOT_FOUND', async () => {
            const caseId = await createCaseFixture();
            await createInvestigationForCase(caseId);

            const res = await getByCase(caseId);
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_006_NOT_FOUND');
        });

        it('a retired investigation: 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);
            await retireInvestigation(investigationId);

            const userRes = await getByCase(caseId, 'USER');
            expect(userRes.status).toBe(404);
            expect(userRes.body.code).toBe('INVADMER_006_INVESTIGATION_NOT_FOUND');
            expect((await getByCase(caseId, 'ADMIN')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

        it('/case is declared before /:id: a malformed caseId is 400', async () => {
            expect((await getByCase('not-a-uuid')).status).toBe(400);
        });
    });

    describe('004 — the differential update', () => {

        it('a PUT that resends the response of its own GET writes nothing', async () => {
            const investigationId = await seed({ notes: 'algo', hadHandlingError: 'YES' });

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id: investigationId,
                model: InvestigationAdministrationError,
                role: 'USER',
                strip: ['investigationId', 'investigation', 'createdAt', 'updatedAt', 'deletedAt', 'appDetails']
            });
        });

        it('an empty body behaves the same way', async () => {
            const investigationId = await seed({ notes: 'algo' });
            const before = await versionOf(investigationId);

            expect((await update(investigationId, {})).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(before);
        });

        it('changing a single field adds one appDetails entry and bumps version by one', async () => {
            const investigationId = await seed();
            const versionBefore = await versionOf(investigationId);
            const entriesBefore = (await appDetailsOf(investigationId)).length;

            const res = await update(investigationId, { notes: 'observacion' });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBe('observacion');

            const entries = await appDetailsOf(investigationId);
            expect(entries).toHaveLength(entriesBefore + 1);
            expect(entries[entries.length - 1].method).toBe('ESAVI-INVADMER-004');
            expect(await versionOf(investigationId)).toBe(versionBefore! + 1);
        });

        it('a change of spacing only writes nothing: trim runs before comparing', async () => {
            const investigationId = await seed({ prescriptionErrorNotes: 'texto' });
            const before = await versionOf(investigationId);

            expect((await update(investigationId, { prescriptionErrorNotes: '  texto  ' })).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(before);
        });

        it('resending false over a stored false writes nothing: false compares as a value', async () => {
            const investigationId = await seed({
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true,
                usedDisposableSyringes: false
            });
            const before = await versionOf(investigationId);

            expect((await update(investigationId, { usedDisposableSyringes: false })).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(before);
        });

        it('investigationId is ignored in silence: 200, nothing written and no 400', async () => {
            const investigationId = await seed();
            const before = await versionOf(investigationId);

            const res = await update(investigationId, { investigationId: unknownUuid });
            expect(res.status).toBe(200);
            expect(res.body.data.investigationId).toBe(investigationId);
            expect(await versionOf(investigationId)).toBe(before);
        });

        it('an unknown id is 404', async () => {
            const res = await update(unknownUuid, { notes: 'x' });
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('INVADMER_004_NOT_FOUND');
        });

        it('a row of a retired investigation: 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);

            expect((await update(investigationId, { notes: 'x' }, 'USER')).status).toBe(404);
            expect((await update(investigationId, { notes: 'x' }, 'ADMIN')).status).toBe(404);
            expect((await update(investigationId, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
        });

        it('the twenty six data columns can all be written, and resending them writes nothing', async () => {
            const investigationId = await seed();
            const payload: Record<string, unknown> = {
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true,
                usedDisposableSyringes: true,
                usedRecycledDisposableSyringes: true,
                usedOtherSyringes: true,
                otherSyringesDescription: 'otras jeringas',
                syringesKeyFindings: 'hallazgo de jeringas',
                reconstitutionUsedSameSyringe: 'YES',
                reconstitutionUsedSameSyringeDifferentVaccine: 'NO',
                reconstitutionUsedDifferentSyringeSameVial: 'UNKNOWN',
                reconstitutionUsedDifferentSyringeDifferentVaccine: 'NOT_APPLICABLE',
                reconstitutionFollowedManufacturerRecommendation: 'NO_ANSWER',
                reconstitutionKeyFindings: 'hallazgo de reconstitucion',
                hadPrescriptionError: 'YES', prescriptionErrorNotes: 'nota 1',
                hadContaminatedVaccine: 'NO', contaminatedVaccineNotes: 'nota 2',
                hadAbnormalVaccineConditions: 'UNKNOWN', abnormalConditionsNotes: 'nota 3',
                hadPreparationError: 'NOT_APPLICABLE', preparationErrorNotes: 'nota 4',
                hadHandlingError: 'NO_ANSWER', handlingErrorNotes: 'nota 5',
                hadImproperAdministration: 'YES', improperAdministrationNotes: 'nota 6',
                notes: 'observacion general'
            };

            const res = await update(investigationId, payload);
            expect(res.status).toBe(200);
            for( const [column, value] of Object.entries(payload) ) {
                expect(res.body.data[column]).toEqual(value);
            }
            // The payload covers every data column of the DDL
            expect(Object.keys(payload).sort()).toEqual([...dataColumns].sort());

            const before = await versionOf(investigationId);
            expect((await update(investigationId, payload)).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(before);
        });
    });

    describe('004 — the syringe block over the resulting state', () => {

        it('a PUT that touches nothing of the block does not fire the minimum rule', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedGlassSyringes: true });

            const res = await update(investigationId, { notes: 'sigue abierto' });
            expect(res.status).toBe(200);
            expect(res.body.data.usedGlassSyringes).toBe(true);
        });

        it('turning off the last true leaves the block open and empty: 400', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedGlassSyringes: true });

            const res = await update(investigationId, { usedGlassSyringes: false });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_004_SYRINGE_TYPE_REQUIRED');
        });

        // The escape hatch of §3.5: closing the flag in the SAME request is what makes the
        // false legal here, and it is the only place of the entity where a false is not an offence
        it('closing the flag in the same request is 200 and empties the five block fields', async () => {
            const investigationId = await seed({
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true,
                usedOtherSyringes: true,
                otherSyringesDescription: 'otras'
            });

            const res = await update(investigationId, {
                usedGlassSyringes: false,
                usedAutoDisableSyringes: 'YES'
            });

            expect(res.status).toBe(200);
            expect(res.body.data.usedAutoDisableSyringes).toBe('YES');
            for( const field of blockFields ) expect(res.body.data[field]).toBeNull();
        });

        it('closing the block without resending anything forces the five fields to null', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedDisposableSyringes: true });

            const res = await update(investigationId, { usedAutoDisableSyringes: 'YES' });
            expect(res.status).toBe(200);
            for( const field of blockFields ) expect(res.body.data[field]).toBeNull();
        });

        it('closing the block while sending a field in true is 400', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedDisposableSyringes: true });

            const res = await update(investigationId, {
                usedAutoDisableSyringes: 'YES',
                usedGlassSyringes: true
            });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_004_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it('closing the block while sending a field in null is 200', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedDisposableSyringes: true });

            const res = await update(investigationId, {
                usedAutoDisableSyringes: 'YES',
                usedGlassSyringes: null
            });
            expect(res.status).toBe(200);
        });

        // The forcing to null goes through the diff like any other candidate: a block that was
        // already closed writes nothing at all
        it('closing an already closed block writes nothing', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'YES' });
            const before = await versionOf(investigationId);

            expect((await update(investigationId, { usedAutoDisableSyringes: 'YES' })).status).toBe(200);
            expect(await versionOf(investigationId)).toBe(before);
        });

        it('reopening the block requires declaring a type in the same request', async () => {
            const investigationId = await seed();

            const empty = await update(investigationId, { usedAutoDisableSyringes: 'NO' });
            expect(empty.status).toBe(400);
            expect(empty.body.code).toBe('INVADMER_004_SYRINGE_TYPE_REQUIRED');

            const withType = await update(investigationId, {
                usedAutoDisableSyringes: 'NO',
                usedRecycledDisposableSyringes: true
            });
            expect(withType.status).toBe(200);
            expect(withType.body.data.usedRecycledDisposableSyringes).toBe(true);
        });

        it('syringesKeyFindings survives the closure of the block', async () => {
            const investigationId = await seed({
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true,
                syringesKeyFindings: 'hallazgo'
            });

            const res = await update(investigationId, { usedAutoDisableSyringes: 'UNKNOWN' });
            expect(res.status).toBe(200);
            expect(res.body.data.syringesKeyFindings).toBe('hallazgo');
        });
    });

    describe('004 — the nested block over the resulting state', () => {

        it('turning off usedOtherSyringes clears the description with no error', async () => {
            const investigationId = await seed({
                usedAutoDisableSyringes: 'NO',
                usedGlassSyringes: true,
                usedOtherSyringes: true,
                otherSyringesDescription: 'de bisel corto'
            });

            const res = await update(investigationId, { usedOtherSyringes: false });
            expect(res.status).toBe(200);
            expect(res.body.data.otherSyringesDescription).toBeNull();
            expect(res.body.data.usedGlassSyringes).toBe(true);
        });

        it('sending the description with the nested block closed is 400, with the nested code', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedGlassSyringes: true });

            const res = await update(investigationId, { otherSyringesDescription: 'de bisel corto' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_004_OTHER_DESCRIPTION_NOT_ALLOWED');
        });

        it('with the OUTER block closed the code is the outer one, not the nested one', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, { otherSyringesDescription: 'de bisel corto' });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVADMER_004_SYRINGE_DETAIL_NOT_ALLOWED');
        });

        it('the description stays never required on the update', async () => {
            const investigationId = await seed({ usedAutoDisableSyringes: 'NO', usedGlassSyringes: true });

            const res = await update(investigationId, { usedOtherSyringes: true });
            expect(res.status).toBe(200);
            expect(res.body.data.otherSyringesDescription).toBeNull();
        });
    });

    describe('004 — the groups with no rules keep having none', () => {

        it.each([
            ['hadPrescriptionError', 'prescriptionErrorNotes'],
            ['hadContaminatedVaccine', 'contaminatedVaccineNotes'],
            ['hadAbnormalVaccineConditions', 'abnormalConditionsNotes'],
            ['hadPreparationError', 'preparationErrorNotes'],
            ['hadHandlingError', 'handlingErrorNotes'],
            ['hadImproperAdministration', 'improperAdministrationNotes']
        ])("moving %s to 'NO' does not empty %s", async (flag, note) => {
            const investigationId = await seed({ [flag]: 'YES', [note]: 'la nota que ya estaba' });

            const res = await update(investigationId, { [flag]: 'NO' });
            expect(res.status).toBe(200);
            expect(res.body.data[note]).toBe('la nota que ya estaba');
        });

        it('the five reconstitution columns can all move to YES in one PUT', async () => {
            const investigationId = await seed();

            const res = await update(investigationId, {
                reconstitutionUsedSameSyringe: 'YES',
                reconstitutionUsedSameSyringeDifferentVaccine: 'YES',
                reconstitutionUsedDifferentSyringeSameVial: 'YES',
                reconstitutionUsedDifferentSyringeDifferentVaccine: 'YES',
                reconstitutionFollowedManufacturerRecommendation: 'YES'
            });
            expect(res.status).toBe(200);
            expect(res.body.data.reconstitutionUsedDifferentSyringeSameVial).toBe('YES');
        });

        it('a stored value is erased by sending it as null', async () => {
            const investigationId = await seed({ notes: 'algo' });

            const res = await update(investigationId, { notes: null });
            expect(res.status).toBe(200);
            expect(res.body.data.notes).toBeNull();
        });
    });

    describe('005C — physical delete', () => {

        it('a row that is not sealed is 409', async () => {
            const investigationId = await seed();

            const res = await purge(investigationId);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('INVADMER_005C_NOT_DELETED');
            expect(await readRow(investigationId)).not.toBeNull();
        });

        it('a sealed row answers 200 without data and is destroyed', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            const res = await purge(investigationId);
            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data).toBeUndefined();
            expect(await readRow(investigationId)).toBeNull();
        });

        it('writes the snapshot of the whole row to the log at warn level', async () => {
            const investigationId = await seed({ notes: 'Ibarra', syringesKeyFindings: 'lote sin marcar' });
            await seal(investigationId);
            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;

            expect((await purge(investigationId)).status).toBe(200);

            const written = fs.readFileSync(logPath, 'utf8').slice(logBefore);
            expect(written).toContain('ESAVI-INVADMER-005C');
            expect(written).toMatch(/WARN/i);
            expect(written).toContain(investigationId);
            expect(written).toContain('lote sin marcar');
        });

        it('only the purge releases the investigationId', async () => {
            const investigationId = await seed();
            await seal(investigationId);

            // Still occupied while only sealed
            expect((await create({ investigationId })).status).toBe(409);

            expect((await purge(investigationId)).status).toBe(200);
            expect((await create({ investigationId })).status).toBe(201);
        });

        it('an unknown id is 404 and an ADMIN is rejected', async () => {
            expect((await purge(unknownUuid)).status).toBe(404);

            const investigationId = await seed();
            await seal(investigationId);
            expect((await purge(investigationId, 'ADMIN')).status).toBe(403);
        });

        it('purges a row whose investigation is already retired', async () => {
            const investigationId = await seed();
            await retireInvestigation(investigationId);
            await seal(investigationId);

            expect((await purge(investigationId)).status).toBe(200);
        });
    });

    describe('the deletedAt cascade', () => {

        it('ESAVI-INVESTGN-005A seals it and ESAVI-INVESTGN-005B clears it', async () => {
            const investigationId = await seed();
            expect(await deletedAtOf(investigationId)).toBeNull();

            expect((await request(app).delete(`/api/investigations/${ investigationId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);
            expect(await deletedAtOf(investigationId)).not.toBeNull();
            expect((await appDetailsOf(investigationId)).map(entry => entry.method))
                .toContain('ESAVI-INVESTGN-005A');

            expect((await request(app).patch(`/api/investigations/activate/${ investigationId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);
            expect(await deletedAtOf(investigationId)).toBeNull();
            expect((await appDetailsOf(investigationId)).map(entry => entry.method))
                .toContain('ESAVI-INVESTGN-005B');
        });

        it('ESAVI-CASE-005A seals it as well', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);

            expect((await request(app).delete(`/api/esavi-cases/${ caseId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);

            expect(await deletedAtOf(investigationId)).not.toBeNull();
            expect((await appDetailsOf(investigationId)).map(entry => entry.method))
                .toContain('ESAVI-CASE-005A');
        });

        it('a row already sealed keeps its date and gets no second entry', async () => {
            const caseId = await createCaseFixture();
            const investigationId = await createInvestigationForCase(caseId);
            expect((await create({ investigationId })).status).toBe(201);

            expect((await request(app).delete(`/api/investigations/${ investigationId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);
            const sealedAt = await deletedAtOf(investigationId);
            const entries = (await appDetailsOf(investigationId)).length;

            await request(app).delete(`/api/esavi-cases/${ caseId }`).set(authHeader('ADMIN'));

            expect((await deletedAtOf(investigationId))!.getTime()).toBe(sealedAt!.getTime());
            expect((await appDetailsOf(investigationId)).length).toBe(entries);
        });

        it('ESAVI-INVESTGN-005C destroys it by cascade and dumps it to the log first', async () => {
            const investigationId = await seed({ notes: 'arrastrada por la cascada' });
            expect((await request(app).delete(`/api/investigations/${ investigationId }`)
                .set(authHeader('ADMIN'))).status).toBe(200);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').length : 0;
            expect((await request(app).delete(`/api/investigations/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'))).status).toBe(200);

            const written = fs.readFileSync(logPath, 'utf8').slice(logBefore);
            expect(written).toContain('ESAVI-INVESTGN-005C');
            expect(written).toContain('Investigation administration error dragged by ON DELETE CASCADE');
            expect(written).toMatch(/WARN/i);
            expect(written).toContain('arrastrada por la cascada');

            expect(await readRow(investigationId)).toBeNull();
        });
    });

    describe('the entity has no state of its own', () => {

        it('there is no 005A: a DELETE over /:id is not a route of this entity', async () => {
            const investigationId = await seed();
            const res = await request(app).delete(`${ basePath }/${ investigationId }`).set(authHeader('ADMIN'));

            expect(res.status).toBe(404);
            expect(await readRow(investigationId)).not.toBeNull();
        });

        it('there is no 005B: a PATCH over /activate/:id is not a route of this entity', async () => {
            const investigationId = await seed();
            const res = await request(app).patch(`${ basePath }/activate/${ investigationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(res.status).toBe(404);
        });

        it('the six pairs and the four booleans are declared, so the shape cannot silently shrink', async () => {
            const investigationId = await seed();
            const body = (await getById(investigationId)).body.data;

            for( const [flag, note] of errorPairs ) {
                expect(body).toHaveProperty(flag);
                expect(body).toHaveProperty(note);
            }
            for( const field of syringeTypes ) expect(body).toHaveProperty(field);
        });
    });
});
