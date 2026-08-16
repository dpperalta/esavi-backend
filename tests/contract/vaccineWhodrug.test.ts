import request from 'supertest';
import { app } from '../../src/app';
import { VaccineWhodrug } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * Contract suite for SPEC F18 — the seven canonical operations of vaccineWhodrug.
 *
 * Three things here are what the schema change of SPEC F19 bought and are the reason the suite goes
 * beyond the usual walkthrough: `drugCode` carries no uniqueness at all and two rows that share it
 * must coexist, `externalId` is the single unique column and is nullable on purpose, and the three
 * booleans — `isPreferred`, and `isGeneric` with its third state — are where a copy-pasted
 * `if( data.x )` breaks in silence.
 */
describe('vaccineWhodrug contract', () => {

    const base = '/api/whodrug-vaccines';

    // The database is shared by every suite of the run, so the rows of this file are isolated by a
    // suffix in drugName — which is what `search` filters on — and by a private externalId range
    const suffix = Date.now().toString(36).toUpperCase();
    const externalIdBase = ( Math.floor(Date.now() / 1000) % 1000000 ) * 100;
    let nextExternalId = externalIdBase;
    const anExternalId = () => ++nextExternalId;

    // errorHandler logs every error it handles, and half of these tests trigger errors on purpose,
    // so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createVaccine = ( payload: Record<string, unknown> ) =>
        request(app).post(base).set(authHeader('ADMIN')).send(payload);

    const readRow = async ( id: string ) => {
        const row = await VaccineWhodrug.findByPk(id);
        return {
            drugCode: row!.getDataValue('drugCode'),
            drugName: row!.getDataValue('drugName'),
            externalId: row!.getDataValue('externalId'),
            isActive: row!.getDataValue('isActive'),
            isGeneric: row!.getDataValue('isGeneric'),
            isPreferred: row!.getDataValue('isPreferred'),
            notes: row!.getDataValue('notes'),
            deletedAt: row!.getDataValue('deletedAt'),
            updatedAt: row!.getDataValue('updatedAt'),
            metadata: row!.getDataValue('metadata') as Record<string, unknown>,
            appDetails: row!.getDataValue('appDetails') as { method: string, user: string }[],
            version: ( row!.getDataValue('sysDetails') as { version?: number } ).version
        };
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('full lifecycle', () => {

        let vaccineWhodrugId: string;

        // ESAVI-WHODRUG-001
        it('create responds 201 with the envelope and the entity trimmed and nothing else', async () => {
            const response = await createVaccine({
                drugCode: '  003649 01 001  ',
                drugName: `  BCG vaccine ${ suffix }  `,
                externalId: anExternalId(),
                atcs: '  J07AN  ',
                iso3Code: '  COL  '
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            // The extremes are trimmed and the interior spaces are not touched: a dictionary code is
            // quoted data, so no toConstantCase either
            expect(response.body.data.drugCode).toBe('003649 01 001');
            // Only trimmed, never toTitleCase, which would turn 'BCG vaccine' into 'Bcg Vaccine'
            expect(response.body.data.drugName).toBe(`BCG vaccine ${ suffix }`);
            expect(response.body.data.atcs).toBe('J07AN');
            expect(response.body.data.iso3Code).toBe('COL');
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-WHODRUG-001');

            vaccineWhodrugId = response.body.data.vaccineWhodrugId;
        });

        // ESAVI-WHODRUG-003
        it('getById responds 200 with the whole shape of 3.7 and never sysDetails', async () => {
            const response = await request(app)
                .get(`${ base }/${ vaccineWhodrugId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            // The 36 columns minus sysDetails. metadata is exposed read-only, as diagnosticTerm does
            expect(Object.keys(response.body.data).sort()).toEqual([
                'abbreviation', 'appDetails', 'atcs', 'countryMedicinalProductId', 'createdAt',
                'deletedAt', 'diluent', 'drugCode', 'drugName', 'drugRecNo', 'drugRecNoSeq',
                'externalId', 'form', 'formMedicinalProductId', 'formTranslations', 'icd11',
                'icd11Term', 'ingredient', 'ingredientTranslation', 'isActive', 'isGeneric',
                'isPreferred', 'iso3Code', 'language', 'languageCode', 'maHolders',
                'maHoldersMedicinalProductId', 'medicinalProductId', 'metadata', 'noDose', 'notes',
                'strength', 'strengthMedicinalProductId', 'updatedAt', 'vaccineWhodrugId'
            ]);
        });

        // ESAVI-WHODRUG-002A
        it('the public listing returns count and rows', async () => {
            const response = await request(app)
                .get(`${ base }?search=${ suffix }&limit=100`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('count');
            expect(response.body.data.rows.map(( r: { vaccineWhodrugId: string } ) => r.vaccineWhodrugId))
                .toContain(vaccineWhodrugId);
            expect(response.body.data.rows[0]).not.toHaveProperty('sysDetails');
        });

        // ESAVI-WHODRUG-002B
        it('the admin listing returns the same row', async () => {
            const response = await request(app)
                .get(`${ base }/admin?search=${ suffix }&limit=100`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.map(( r: { vaccineWhodrugId: string } ) => r.vaccineWhodrugId))
                .toContain(vaccineWhodrugId);
        });

        // ESAVI-WHODRUG-004
        it('update responds 200 and trims the new values without normalizing them', async () => {
            const response = await request(app)
                .put(`${ base }/${ vaccineWhodrugId }`)
                .set(authHeader('ADMIN'))
                .send({ drugCode: '  003649 01 002  ', drugName: `  BCG-SSI ${ suffix }  ` });

            expect(response.status).toBe(200);
            expect(response.body.data.drugCode).toBe('003649 01 002');
            expect(response.body.data.drugName).toBe(`BCG-SSI ${ suffix }`);
        });

        // ESAVI-WHODRUG-005A
        it('delete deactivates, stamps deletedAt and answers without data', async () => {
            const response = await request(app)
                .delete(`${ base }/${ vaccineWhodrugId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(vaccineWhodrugId);
            expect(row.isActive).toBe(false);
            expect(row.deletedAt).toBeInstanceOf(Date);
            // Only the operation code, with no _ACTIVATION stuck behind it
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-WHODRUG-005A');
        });

        // ESAVI-WHODRUG-005B
        it('activate reverses it and answers without data', async () => {
            const response = await request(app)
                .patch(`${ base }/activate/${ vaccineWhodrugId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(vaccineWhodrugId);
            expect(row.isActive).toBe(true);
            expect(row.deletedAt).toBeNull();
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-WHODRUG-005B');
        });

        it('every write appended to appDetails without erasing the previous ones', async () => {
            const row = await readRow(vaccineWhodrugId);
            expect(row.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-WHODRUG-001',
                'ESAVI-WHODRUG-004',
                'ESAVI-WHODRUG-005A',
                'ESAVI-WHODRUG-005B'
            ]);
        });
    });

    describe('drugCode carries no uniqueness', () => {

        // The criterion that justifies the schema change of SPEC F19: the WHODrug file repeats
        // drugCode by design, one row per country presentation, and the import would die on its
        // third line if the old UQ_vaccineWhodrug_drugCode were still in place
        it('two rows with the same drugCode and a different externalId coexist', async () => {
            const drugCode = `SHARED-${ suffix }`;

            const first = await createVaccine({ drugCode, drugName: `Shared code A ${ suffix }`, externalId: anExternalId() });
            const second = await createVaccine({ drugCode, drugName: `Shared code B ${ suffix }`, externalId: anExternalId() });

            expect(first.status).toBe(201);
            expect(second.status).toBe(201);

            const rows = await VaccineWhodrug.findAll({ where: { drugCode } });
            expect(rows).toHaveLength(2);
        });

        it('an update to a drugCode another row already uses responds 200 and writes', async () => {
            const taken = `TAKEN-${ suffix }`;
            await createVaccine({ drugCode: taken, drugName: `Taken ${ suffix }`, externalId: anExternalId() });
            const mine = await createVaccine({ drugCode: `MINE-${ suffix }`, drugName: `Mine ${ suffix }`, externalId: anExternalId() });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.vaccineWhodrugId }`)
                .set(authHeader('ADMIN'))
                .send({ drugCode: taken });

            expect(response.status).toBe(200);
            expect(( await readRow(mine.body.data.vaccineWhodrugId) ).drugCode).toBe(taken);
        });
    });

    describe('uniqueness of externalId', () => {

        it('creating the same externalId twice responds 409 and not 500', async () => {
            const externalId = anExternalId();
            await createVaccine({ drugCode: `DUP-A-${ suffix }`, drugName: `Dup A ${ suffix }`, externalId });

            const response = await createVaccine({ drugCode: `DUP-B-${ suffix }`, drugName: `Dup B ${ suffix }`, externalId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('WHODRUG_001_EXTERNAL_ID_EXISTS');
        });

        it('the check does not filter by isActive: an inactive row still occupies the key', async () => {
            const externalId = anExternalId();
            const created = await createVaccine({ drugCode: `INACT-${ suffix }`, drugName: `Inactive holder ${ suffix }`, externalId });
            await request(app).delete(`${ base }/${ created.body.data.vaccineWhodrugId }`).set(authHeader('ADMIN'));

            const response = await createVaccine({ drugCode: `INACT-B-${ suffix }`, drugName: `Inactive clash ${ suffix }`, externalId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('WHODRUG_001_EXTERNAL_ID_EXISTS');
        });

        it('creating without externalId stores null, and two such rows coexist', async () => {
            const first = await createVaccine({ drugCode: `NOEXT-A-${ suffix }`, drugName: `No external A ${ suffix }` });
            const second = await createVaccine({ drugCode: `NOEXT-B-${ suffix }`, drugName: `No external B ${ suffix }` });

            expect(first.status).toBe(201);
            expect(second.status).toBe(201);
            expect(first.body.data.externalId).toBeNull();
            expect(second.body.data.externalId).toBeNull();
        });

        it('an update to an occupied externalId responds 409 even when nothing else changes', async () => {
            const externalId = anExternalId();
            await createVaccine({ drugCode: `UPD-A-${ suffix }`, drugName: `Update holder ${ suffix }`, externalId });
            const mine = await createVaccine({ drugCode: `UPD-B-${ suffix }`, drugName: `Update mine ${ suffix }`, externalId: anExternalId() });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.vaccineWhodrugId }`)
                .set(authHeader('ADMIN'))
                .send({ externalId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('WHODRUG_004_EXTERNAL_ID_EXISTS');
        });

        it('an update resending its own externalId is not a collision with itself', async () => {
            const externalId = anExternalId();
            const mine = await createVaccine({ drugCode: `SELF-${ suffix }`, drugName: `Self ${ suffix }`, externalId });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.vaccineWhodrugId }`)
                .set(authHeader('ADMIN'))
                .send({ externalId, drugName: `Self renamed ${ suffix }` });

            expect(response.status).toBe(200);
        });

        it('an update with externalId null empties the column', async () => {
            const mine = await createVaccine({ drugCode: `EMPTY-${ suffix }`, drugName: `Empty ${ suffix }`, externalId: anExternalId() });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.vaccineWhodrugId }`)
                .set(authHeader('ADMIN'))
                .send({ externalId: null });

            expect(response.status).toBe(200);
            expect(( await readRow(mine.body.data.vaccineWhodrugId) ).externalId).toBeNull();
        });
    });

    describe('validation', () => {

        it('creating without drugCode responds 400', async () => {
            const response = await createVaccine({ drugName: `No code ${ suffix }` });
            expect(response.status).toBe(400);
        });

        it('creating without drugName responds 400', async () => {
            const response = await createVaccine({ drugCode: `NO-NAME-${ suffix }` });
            expect(response.status).toBe(400);
        });

        it('a search shorter than two characters responds 400 in both listings', async () => {
            expect(( await request(app).get(`${ base }?search=b`).set(authHeader('USER')) ).status).toBe(400);
            expect(( await request(app).get(`${ base }/admin?search=b`).set(authHeader('ADMIN')) ).status).toBe(400);
        });

        it('a limit above 100 responds 400', async () => {
            expect(( await request(app).get(`${ base }?limit=101`).set(authHeader('USER')) ).status).toBe(400);
        });

        it('an id that is not a UUID responds 400', async () => {
            expect(( await request(app).get(`${ base }/not-a-uuid`).set(authHeader('USER')) ).status).toBe(400);
        });
    });

    describe('the listings and their five filters', () => {

        const listSuffix = `FILTER${ suffix }`;
        let preferredId: string;
        let inactiveId: string;

        beforeAll(async () => {
            const preferred = await createVaccine({
                drugCode: `F1-${ suffix }`, drugName: `BCG ${ listSuffix }`, externalId: anExternalId(),
                language: 'en', iso3Code: 'COL', isPreferred: true, isGeneric: true
            });
            preferredId = preferred.body.data.vaccineWhodrugId;
            await createVaccine({
                drugCode: `F2-${ suffix }`, drugName: `Vacuna bcg ${ listSuffix }`, externalId: anExternalId(),
                language: 'es', iso3Code: 'ECU', isPreferred: false, isGeneric: false
            });
            // isGeneric left unset, so it stays null — the third state
            await createVaccine({
                drugCode: `F3-${ suffix }`, drugName: `Anti-rabies ${ listSuffix }`, externalId: anExternalId(),
                language: 'en', iso3Code: 'COL'
            });
            const inactive = await createVaccine({
                drugCode: `F4-${ suffix }`, drugName: `BCG retired ${ listSuffix }`, externalId: anExternalId()
            });
            inactiveId = inactive.body.data.vaccineWhodrugId;
            await request(app).delete(`${ base }/${ inactiveId }`).set(authHeader('ADMIN'));
        });

        const publicNames = async ( qs: string ): Promise<string[]> => {
            const response = await request(app).get(`${ base }?${ qs }&limit=100`).set(authHeader('USER'));
            expect(response.status).toBe(200);
            return response.body.data.rows.map(( r: { drugName: string } ) => r.drugName);
        };

        const adminNames = async ( qs: string ): Promise<string[]> => {
            const response = await request(app).get(`${ base }/admin?${ qs }&limit=100`).set(authHeader('ADMIN'));
            expect(response.status).toBe(200);
            return response.body.data.rows.map(( r: { drugName: string } ) => r.drugName);
        };

        it('search matches any position of drugName and ignores case', async () => {
            const names = await publicNames(`search=bcg ${ listSuffix }`);
            expect(names).toEqual(expect.arrayContaining([`BCG ${ listSuffix }`, `Vacuna bcg ${ listSuffix }`]));
        });

        it('the public listing hides the inactive row and the admin listing shows it', async () => {
            expect(await publicNames(`search=${ listSuffix }`)).not.toContain(`BCG retired ${ listSuffix }`);
            expect(await adminNames(`search=${ listSuffix }`)).toContain(`BCG retired ${ listSuffix }`);
        });

        it('isPreferred=false returns the unpreferred rows and not an empty list', async () => {
            const names = await publicNames(`search=${ listSuffix }&isPreferred=false`);
            expect(names.length).toBeGreaterThan(0);
            expect(names).not.toContain(`BCG ${ listSuffix }`);
            expect(names).toContain(`Vacuna bcg ${ listSuffix }`);
        });

        it('isGeneric=false returns only the false ones, never the null ones', async () => {
            const names = await publicNames(`search=${ listSuffix }&isGeneric=false`);
            expect(names).toContain(`Vacuna bcg ${ listSuffix }`);
            expect(names).not.toContain(`Anti-rabies ${ listSuffix }`);
        });

        it('language and iso3Code are exact equality and combine with AND', async () => {
            const names = await publicNames(`search=${ listSuffix }&language=en&iso3Code=COL`);
            expect(names).toEqual(expect.arrayContaining([`Anti-rabies ${ listSuffix }`, `BCG ${ listSuffix }`]));
            expect(names).not.toContain(`Vacuna bcg ${ listSuffix }`);
        });

        it('the default order is drugName ASC', async () => {
            const names = await publicNames(`search=${ listSuffix }`);
            expect(names).toEqual([...names].sort());
        });

        it('the two listings paginate over the same count', async () => {
            const response = await request(app)
                .get(`${ base }?search=${ listSuffix }&limit=1&offset=1`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows).toHaveLength(1);
        });

        it('GET /admin is not captured as an :id', async () => {
            const response = await request(app).get(`${ base }/admin`).set(authHeader('ADMIN'));
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('rows');
        });

        it('an inactive row is a 404 for USER and for ADMIN, and a 200 for SUPERADMIN', async () => {
            // canViewInactive is SUPERADMIN-only while 002B is ADMIN: the asymmetry is deliberate
            // and is the same one healthFacility and diagnosticTerm already have
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('USER')) ).status).toBe(404);
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('ADMIN')) ).status).toBe(404);
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('SUPERADMIN')) ).status).toBe(200);
        });

        it('an unknown id responds 404 with the operation code', async () => {
            const response = await request(app)
                .get(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('WHODRUG_003_NOT_FOUND');
        });

        it('the preferred row is still reachable by id', async () => {
            expect(( await request(app).get(`${ base }/${ preferredId }`).set(authHeader('USER')) ).status).toBe(200);
        });
    });

    describe('differential update', () => {

        let id: string;

        beforeEach(async () => {
            const created = await createVaccine({
                drugCode: `DIFF-${ suffix }-${ nextExternalId }`,
                drugName: `Differential ${ suffix } ${ nextExternalId }`,
                externalId: anExternalId(),
                isPreferred: true,
                isGeneric: true,
                notes: 'first'
            });
            id = created.body.data.vaccineWhodrugId;
        });

        const put = ( payload: Record<string, unknown> ) =>
            request(app).put(`${ base }/${ id }`).set(authHeader('ADMIN')).send(payload);

        it('a PUT resending the whole GET response writes nothing', async () => {
            await expectPutOfGetResponseWritesNothing({ path: base, id, model: VaccineWhodrug });
        });

        it('a PUT with an empty body behaves the same way', async () => {
            const before = await readRow(id);

            const response = await put({});

            expect(response.status).toBe(200);
            const after = await readRow(id);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(after.version).toBe(before.version);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('a PUT changing a single field adds one appDetails entry and bumps the version by one', async () => {
            const before = await readRow(id);

            const response = await put({ drugName: `Differential renamed ${ suffix }` });

            expect(response.status).toBe(200);
            const after = await readRow(id);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.appDetails.at(-1)!.method).toBe('ESAVI-WHODRUG-004');
            expect(after.version).toBe(before.version! + 1);
        });

        it('isActive in the body responds 200 and does not deactivate the row', async () => {
            const response = await put({ isActive: false });

            expect(response.status).toBe(200);
            expect(( await readRow(id) ).isActive).toBe(true);
        });

        it('metadata in the body responds 200 and is not written', async () => {
            const response = await put({ metadata: { importedFrom: 'forged' } });

            expect(response.status).toBe(200);
            expect(( await readRow(id) ).metadata).toEqual({});
        });

        it('an unknown id responds 404 with the operation code', async () => {
            const response = await request(app)
                .put(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('ADMIN'))
                .send({ drugName: 'whatever' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('WHODRUG_004_NOT_FOUND');
        });

        describe('the booleans and the nullables', () => {

            it('isPreferred false over a stored true writes: the false is not discarded', async () => {
                const response = await put({ isPreferred: false });

                expect(response.status).toBe(200);
                expect(( await readRow(id) ).isPreferred).toBe(false);
            });

            it('isGeneric null over a stored true empties the column', async () => {
                const response = await put({ isGeneric: null });

                expect(response.status).toBe(200);
                expect(( await readRow(id) ).isGeneric).toBeNull();
            });

            it('isGeneric false over a stored null writes: false and null are different values', async () => {
                await put({ isGeneric: null });
                const before = await readRow(id);
                expect(before.isGeneric).toBeNull();

                const response = await put({ isGeneric: false });

                expect(response.status).toBe(200);
                const after = await readRow(id);
                expect(after.isGeneric).toBe(false);
                expect(after.version).toBe(before.version! + 1);
            });

            it('a PUT without the isGeneric key leaves the column as it was', async () => {
                const before = await readRow(id);

                await put({ drugName: `Untouched generic ${ suffix }` });

                expect(( await readRow(id) ).isGeneric).toBe(before.isGeneric);
            });

            it('notes null empties the column and notes "" stores the empty string', async () => {
                await put({ notes: null });
                expect(( await readRow(id) ).notes).toBeNull();

                await put({ notes: '' });
                expect(( await readRow(id) ).notes).toBe('');
            });
        });
    });

    describe('activation', () => {

        let id: string;

        beforeEach(async () => {
            const created = await createVaccine({
                drugCode: `ACT-${ suffix }-${ nextExternalId }`,
                drugName: `Activation ${ suffix } ${ nextExternalId }`,
                externalId: anExternalId()
            });
            id = created.body.data.vaccineWhodrugId;
        });

        it('deactivating twice responds 409', async () => {
            await request(app).delete(`${ base }/${ id }`).set(authHeader('ADMIN'));

            const response = await request(app).delete(`${ base }/${ id }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('WHODRUG_005A_ALREADY_INACTIVE');
        });

        it('activating what is already active responds 409', async () => {
            const response = await request(app).patch(`${ base }/activate/${ id }`).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('WHODRUG_005B_ALREADY_ACTIVE');
        });

        it('deleting an unknown id responds 404', async () => {
            const response = await request(app)
                .delete(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('WHODRUG_005A_NOT_FOUND');
        });
    });
});
