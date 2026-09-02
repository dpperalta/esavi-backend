import path from 'path';
import ExcelJS from 'exceljs';
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

        // SPEC F52 — name and code become the canonical parameters over drugName/drugCode, search
        // survives as their alias
        describe('canonical name/code parameters — SPEC F52', () => {

            const codeSuffix = `CODE${ suffix }`;
            let byCodeId: string;

            beforeAll(async () => {
                const created = await createVaccine({
                    drugCode: `LOOKUP_${ codeSuffix }`, drugName: `Lookup by code ${ suffix }`, externalId: anExternalId()
                });
                byCodeId = created.body.data.vaccineWhodrugId;
                await createVaccine({ drugCode: `WILD_A_${ suffix }`, drugName: `Wildcard probe ${ suffix }`, externalId: anExternalId() });
                await createVaccine({ drugCode: `WILDXA_${ suffix }`, drugName: `Wildcard probe twin ${ suffix }`, externalId: anExternalId() });
            });

            it('name matches partially over drugName', async () => {
                const names = await publicNames(`name=bcg ${ listSuffix }`);
                expect(names).toEqual(expect.arrayContaining([`BCG ${ listSuffix }`, `Vacuna bcg ${ listSuffix }`]));
            });

            it('code matches partially over drugCode', async () => {
                const response = await request(app).get(`${ base }?code=lookup_${ codeSuffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { vaccineWhodrugId: string }) => r.vaccineWhodrugId)).toEqual([byCodeId]);
            });

            it('name and code combine with Op.or — a match on either is enough', async () => {
                const response = await request(app)
                    .get(`${ base }?name=noExisteEsteNombre${ suffix }&code=lookup_${ codeSuffix }&limit=100`)
                    .set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { vaccineWhodrugId: string }) => r.vaccineWhodrugId)).toContain(byCodeId);
            });

            it('explicit name wins over search when both arrive', async () => {
                // search stays fully suffixed so its fallback over drugCode cannot pick up an
                // unrelated row from another suite's fixtures sharing this database
                const response = await request(app)
                    .get(`${ base }?name=Anti-rabies ${ listSuffix }&search=bcg ${ listSuffix }&limit=100`)
                    .set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { drugName: string }) => r.drugName)).toEqual([`Anti-rabies ${ listSuffix }`]);
            });

            it('search keeps covering both drugName and drugCode, now also matching by code', async () => {
                const response = await request(app).get(`${ base }?search=lookup_${ codeSuffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { vaccineWhodrugId: string }) => r.vaccineWhodrugId)).toContain(byCodeId);
            });

            it('a literal underscore in code does not act as a single-character wildcard', async () => {
                const response = await request(app).get(`${ base }?code=WILD_A_${ suffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                const codes = response.body.data.rows.map((r: { drugCode: string }) => r.drugCode);
                expect(codes).toContain(`WILD_A_${ suffix }`);
                expect(codes).not.toContain(`WILDXA_${ suffix }`);
            });

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

    /**
     * SPEC F19 — ESAVI-WHODRUG-007, bulk import from a WHODrug .xlsx file. It is the only operation
     * of the entity that speaks multipart/form-data, the only one that answers with the report of a
     * process instead of a resource, and the only entry that ever populates the catalog: there is no
     * implicit resolution, so without this endpoint the dictionary stays empty forever.
     *
     * The fixture has seven data rows on purpose: the three BCG presentations of §1 — the same
     * drugCode with three different ids, which is the case the whole schema change exists for — plus
     * one with no id, one with no drugName, one repeating an id already seen and one whose drugCode
     * exceeds the varchar(250) of the column. That is read: 7, inserted: 3, invalid: 3, duplicated: 1.
     */
    describe('bulk import — ESAVI-WHODRUG-007', () => {

        const fixturePath = path.resolve(__dirname, '../fixtures/whodrug-vaccines-sample.xlsx');

        // The fixture ids, so the assertions read as what they are
        const firstId = 25120001;
        const holderId = 25120002;
        const spanishId = 25120003;
        const fixtureIds = [firstId, holderId, spanishId];
        const sharedDrugCode = '00002001001';

        // The header row of the fixture, in its order, so a variant can drop or rename one column
        const maHoldersColumn = 17;
        const ingredientTranslationsColumn = 13;

        const importFile = ( role: string = 'SUPERADMIN' ) =>
            request(app).post(`${ base }/import`).set(authHeader(role));

        const countFixtureRows = () => VaccineWhodrug.count({ where: { externalId: fixtureIds } });

        const readByExternalId = async ( externalId: number ) => {
            const row = await VaccineWhodrug.findOne({ where: { externalId } });
            return {
                drugCode: row!.getDataValue('drugCode'),
                drugName: row!.getDataValue('drugName'),
                iso3Code: row!.getDataValue('iso3Code'),
                maHolders: row!.getDataValue('maHolders'),
                atcs: row!.getDataValue('atcs'),
                isActive: row!.getDataValue('isActive'),
                isGeneric: row!.getDataValue('isGeneric'),
                isPreferred: row!.getDataValue('isPreferred'),
                notes: row!.getDataValue('notes'),
                updatedAt: row!.getDataValue('updatedAt'),
                metadata: row!.getDataValue('metadata') as Record<string, unknown>,
                appDetails: ( row!.getDataValue('appDetails') as { method: string }[] ).length,
                version: ( row!.getDataValue('sysDetails') as { version?: number } ).version
            };
        };

        // The fixture itself, reopened so a variant can change exactly one cell and nothing else
        const buildVariant = async ( mutate: ( worksheet: ExcelJS.Worksheet ) => void ): Promise<Buffer> => {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(fixturePath);
            mutate(workbook.worksheets[0]);
            return Buffer.from(await workbook.xlsx.writeBuffer());
        };

        it('rejects ADMIN with 403 — the widest write over the entity is SUPERADMIN only', async () => {
            const response = await importFile('ADMIN').attach('file', fixturePath);

            expect(response.status).toBe(403);
        });

        it('responds 400 when no file travels', async () => {
            const response = await importFile();

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe('WHODRUG_007_FILE_REQUIRED');
        });

        it('responds 400 when the buffer is not an .xlsx workbook', async () => {
            const response = await importFile()
                .attach('file', Buffer.from('esto no es un libro de excel', 'utf8'), 'bad.xlsx');

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('WHODRUG_007_FILE_INVALID');
        });

        // The column exists or the file is not a WHODrug dictionary. The cut happens before a single
        // data row is read, so a book that is valid everywhere else still writes nothing
        it('responds 400 and writes nothing when a required header is missing', async () => {
            const withoutIngredientTranslations = await buildVariant(( worksheet ) => {
                worksheet.spliceColumns(ingredientTranslationsColumn, 1);
            });

            const response = await importFile().attach('file', withoutIngredientTranslations, 'whodrug.xlsx');

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('WHODRUG_007_FILE_INVALID');
            expect(await countFixtureRows()).toBe(0);
        });

        // dryRun runs before the real import on purpose: it is the only moment the table is
        // guaranteed empty of these ids, so "wrote nothing" can be asserted without ambiguity
        it('dryRun reports the same numbers and writes nothing', async () => {
            const response = await importFile().field('dryRun', 'true').attach('file', fixturePath);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                read: 7, inserted: 3, updated: 0, unchanged: 0, invalid: 3, duplicated: 1, dryRun: true
            });
            expect(await countFixtureRows()).toBe(0);
        });

        it('responds 200 with the process report and writes only the valid rows', async () => {
            const response = await importFile()
                .field('dictionaryVersion', 'WHODrug Global 2025 Sep 1')
                .attach('file', fixturePath);

            // 200 and not 201: there is no resource to point at, only the report of a process
            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toMatchObject({
                read: 7, inserted: 3, updated: 0, unchanged: 0, invalid: 3, duplicated: 1,
                dryRun: false, sheet: 'WHODrug Vaccines'
            });
            // Not a single vaccineWhodrugId comes back
            expect(JSON.stringify(response.body.data)).not.toContain('vaccineWhodrugId');
            // The rejected sample carries the row number and the reason of each one, and column only
            // where the reason does not name it already
            expect(response.body.data.errors).toEqual([
                { row: 5, reason: 'INVALID_EXTERNAL_ID' },
                { row: 6, reason: 'EMPTY_DRUG_NAME' },
                { row: 7, reason: 'DUPLICATE_IN_FILE' },
                { row: 8, reason: 'VALUE_TOO_LONG', column: 'drugCode' }
            ]);
            // The whole header of the fixture resolves, and nothing is left over
            expect(response.body.data.missingOptionalHeaders).toEqual([]);
            expect(response.body.data.unknownHeaders).toEqual([]);
            expect(await countFixtureRows()).toBe(3);
        });

        // The criterion that justifies the schema change of §3.1: with UQ_vaccineWhodrug_drugCode in
        // place the second row of the file would have blown up the batch
        it('imports the three presentations that share a drugCode', async () => {
            const rows = await VaccineWhodrug.findAll({ where: { externalId: fixtureIds } });

            expect(rows).toHaveLength(3);
            expect(rows.every(( row ) => row.getDataValue('drugCode') === sharedDrugCode)).toBe(true);
        });

        it('stores the dictionary values as quoted data and marks the row as imported', async () => {
            const first = await readByExternalId(firstId);
            const spanish = await readByExternalId(spanishId);

            // Only trimmed: never toConstantCase on the code, never toTitleCase on the name
            expect(first.drugCode).toBe(sharedDrugCode);
            expect(first.drugName).toBe('Bcg vaccine');
            expect(spanish.drugName).toBe('{Vacuna BCG}');
            // The column the DDL used to call 'acts'
            expect(first.atcs).toBe('J07AN');
            // There is no reviewStatus, unlike the .asc importer: this entity has no review queue
            expect(first.metadata).toMatchObject({
                importedFrom: 'WHODRUG',
                autoCreated: false,
                dictionaryVersion: 'WHODrug Global 2025 Sep 1'
            });
            expect(first.metadata.importedAt).toBeDefined();
            expect(first.metadata.reviewStatus).toBeUndefined();
            // The file does not bring notes, so the column stays null and a note written by the 004
            // has somewhere to live
            expect(first.notes).toBeNull();
        });

        it('reads an empty cell as null and each boolean by its own rule', async () => {
            const first = await readByExternalId(firstId);
            const holder = await readByExternalId(holderId);
            const spanish = await readByExternalId(spanishId);

            // Never '': an empty cell in Excel means "no data", and a '' would make the diff of a
            // reimport see a change that is not there
            expect(first.iso3Code).toBeNull();
            expect(first.maHolders).toBeNull();
            expect(holder.iso3Code).toBe('PRI');
            // isPreferred is NOT NULL DEFAULT false and admits no null in any layer
            expect(first.isPreferred).toBe(true);
            expect(holder.isPreferred).toBe(false);
            // isGeneric got no DEFAULT in the DDL, so null is a value of its own, distinct from false
            expect(first.isGeneric).toBeNull();
            expect(spanish.isGeneric).toBe(false);
        });

        // The criterion that really discriminates: a differential update that is not differential
        // would pass every other test in this block
        it('reimporting the same file writes nothing at all', async () => {
            const before = await Promise.all(fixtureIds.map(readByExternalId));

            const response = await importFile()
                .field('dictionaryVersion', 'WHODrug Global 2025 Sep 1')
                .attach('file', fixturePath);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ read: 7, inserted: 0, updated: 0, unchanged: 3 });

            const after = await Promise.all(fixtureIds.map(readByExternalId));
            // No appDetails entry, no sysDetails.version bump and no updatedAt moved
            expect(after).toEqual(before);
        });

        // Reimporting must not overwrite where a row first came from, which is the only thing that
        // lets anyone audit which release each entry belongs to
        it('does not rewrite metadata when the dictionaryVersion changes', async () => {
            await importFile().field('dictionaryVersion', 'WHODrug Global 2026 Mar 1').attach('file', fixturePath);

            const first = await readByExternalId(firstId);

            expect(first.metadata.dictionaryVersion).toBe('WHODrug Global 2025 Sep 1');
        });

        it('a single changed cell produces updated: 1 and leaves the rest unchanged', async () => {
            const before = await readByExternalId(holderId);
            const renamedHolder = await buildVariant(( worksheet ) => {
                worksheet.getRow(3).getCell(maHoldersColumn).value = 'Organon BV';
            });

            const response = await importFile().attach('file', renamedHolder, 'whodrug.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });

            const after = await readByExternalId(holderId);
            expect(after.maHolders).toBe('Organon BV');
            // Exactly one entry added and exactly one version bump
            expect(after.appDetails).toBe(before.appDetails + 1);
            expect(after.version).toBe(( before.version ?? 0 ) + 1);
        });

        // Unlike the .asc importer, this file declares no currency at all, so inferring one from it
        // would be inventing it: whoever deactivated the row is the authority, not the dictionary
        it('does not reactivate a row that was deactivated with the 005A', async () => {
            const row = await VaccineWhodrug.findOne({ where: { externalId: spanishId } });
            await request(app).delete(`${ base }/${ row!.getDataValue('vaccineWhodrugId') }`).set(authHeader('ADMIN'));
            const before = await readByExternalId(spanishId);

            const response = await importFile().attach('file', fixturePath);

            expect(response.status).toBe(200);
            const after = await readByExternalId(spanishId);
            expect(after.isActive).toBe(false);
            // isActive and deletedAt never enter the diff, so this row was left alone entirely: the
            // aggregate is not asserted here because the previous test left another row to revert
            expect(after.appDetails).toBe(before.appDetails);
            expect(after.version).toBe(before.version);
        });

        // An export that renames a column does not fail — the load goes on — but it leaves that
        // column null in every row, and without the notice nobody spots it
        it('ignores an unknown header and reports both header lists', async () => {
            const withRenamedColumn = await buildVariant(( worksheet ) => {
                worksheet.getRow(1).getCell(maHoldersColumn).value = 'comentarios';
            });

            const response = await importFile().field('dryRun', 'true').attach('file', withRenamedColumn, 'whodrug.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data.unknownHeaders).toEqual(['comentarios']);
            expect(response.body.data.missingOptionalHeaders).toEqual(['maHolders']);
        });

        // The header is matched normalized on top of the alias table, so an export that changes the
        // case or the separators of a column still resolves
        it('resolves a header written with spaces and another case', async () => {
            const shoutedHeader = await buildVariant(( worksheet ) => {
                worksheet.getRow(1).getCell(21).value = 'FORMS MEDICINAL PRODUCT ID';
            });

            const response = await importFile().field('dryRun', 'true').attach('file', shoutedHeader, 'whodrug.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data.unknownHeaders).toEqual([]);
            expect(response.body.data.missingOptionalHeaders).toEqual([]);
            expect(response.body.data.unchanged).toBe(3);
        });
    });

    /**
     * SPEC F54 — the five levels of the tree, ESAVI-WHODRUG-006A..006E.
     *
     * What this block is really guarding is `matchCount`: the count that says whether the vaccine
     * is already determined. It is per option, not per level, and it is what lets the frontend stop
     * unfolding lists. The rest — the null option and its sentinel, the country subset, the
     * inactive rows — are the ways that count can silently go wrong.
     */
    describe('tree navigation', () => {

        // One private branch of the tree, isolated from every other row of the database by an
        // abbreviation nobody else uses. Four generic preferred rows plus one of a country:
        //
        //   SOLO   → ALPHA → INYECTABLE → 1 MG      unique from the drugName down
        //   MULTI  → BETA  → INYECTABLE → 2 MG
        //   MULTI  → BETA  → INYECTABLE → 3 MG
        //   MULTI  → null  → ORAL       → 4 MG      the option with no value
        //   PAIS   → GAMMA → INYECTABLE → 5 MG      only inside ?country=ECU
        const abbreviation = `TREE${ suffix }`;
        const soloName = `SOLO ${ suffix }`;
        const multiName = `MULTI ${ suffix }`;
        const countryName = `PAIS ${ suffix }`;
        let soloId: string;
        let nullBranchId: string;

        const navigate = ( level: string, query: Record<string, string> ) =>
            request(app).get(`${ base }/${ level }`).set(authHeader('USER')).query({ language: 'es', ...query });

        const createBranchRow = ( payload: Record<string, unknown> ) => createVaccine({
            drugCode: `TREE-${ suffix }`,
            externalId: anExternalId(),
            abbreviation,
            // No iso3Code: the row lands in the generic branch of the subset, which is the one that
            // answers when the request carries no ?country=
            language: 'es',
            isPreferred: true,
            ...payload
        });

        beforeAll(async () => {
            const solo = await createBranchRow({ drugName: soloName, maHolders: 'ALPHA', formTranslations: 'INYECTABLE', strength: '1 MG' });
            soloId = solo.body.data.vaccineWhodrugId;
            await createBranchRow({ drugName: multiName, maHolders: 'BETA', formTranslations: 'INYECTABLE', strength: '2 MG' });
            await createBranchRow({ drugName: multiName, maHolders: 'BETA', formTranslations: 'INYECTABLE', strength: '3 MG' });
            const nullBranch = await createBranchRow({ drugName: multiName, maHolders: null, formTranslations: 'ORAL', strength: '4 MG' });
            nullBranchId = nullBranch.body.data.vaccineWhodrugId;
            await createBranchRow({ drugName: countryName, maHolders: 'GAMMA', formTranslations: 'INYECTABLE', strength: '5 MG', iso3Code: 'ECU' });
        });

        // ESAVI-WHODRUG-006A
        it('the abbreviations level answers with the envelope and finds the branch', async () => {
            const response = await navigate('abbreviations', { search: abbreviation });

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(Object.keys(response.body).sort()).toEqual(['data', 'message', 'ok']);
            expect(response.body.data.options).toEqual([
                { value: abbreviation, matchCount: 4, vaccineWhodrugId: null }
            ]);
            expect(response.body.data.count).toBe(1);
            expect(response.body.data.total).toBe(4);
        });

        // ESAVI-WHODRUG-006B — the case the whole spec exists for: one of the two names is already
        // a single vaccine and comes with its id resolved, the other still has to be unfolded
        it('the drug names level resolves the id of the option that is already unique', async () => {
            const response = await navigate('drug-names', { abbreviation });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.total).toBe(4);
            expect(response.body.data.options).toEqual([
                { value: multiName, matchCount: 3, vaccineWhodrugId: null },
                { value: soloName, matchCount: 1, vaccineWhodrugId: soloId }
            ]);
        });

        // Postgres hands COUNT over as a bigint, which the driver turns into a string. Shipped as
        // "matchCount": "1" the client's === 1 fails and no list ever closes
        it('matchCount travels as a number, not as a string', async () => {
            const response = await navigate('drug-names', { abbreviation });

            for( const option of response.body.data.options ) {
                expect(typeof option.matchCount).toBe('number');
            }
        });

        it('the id of a unique option answers the getById', async () => {
            const response = await navigate('drug-names', { abbreviation });
            const unique = response.body.data.options.find(( option: { matchCount: number } ) => option.matchCount === 1);

            const detail = await request(app).get(`${ base }/${ unique.vaccineWhodrugId }`).set(authHeader('USER'));

            expect(detail.status).toBe(200);
            expect(detail.body.data.drugName).toBe(soloName);
        });

        // ESAVI-WHODRUG-006C — four of the five columns of the tree are nullable, and without an
        // option of its own the row behind the null would be unreachable by navigation
        it('the ma holders level lists the rows with no value as one option, last', async () => {
            const response = await navigate('ma-holders', { abbreviation, drugName: multiName });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.total).toBe(3);
            expect(response.body.data.options).toEqual([
                { value: 'BETA', matchCount: 2, vaccineWhodrugId: null },
                { value: null, matchCount: 1, vaccineWhodrugId: nullBranchId }
            ]);
        });

        // ESAVI-WHODRUG-006D
        it('the __NULL__ sentinel takes the navigation down the branch with no value', async () => {
            const response = await navigate('forms', { drugName: multiName, maHolders: '__NULL__' });

            expect(response.status).toBe(200);
            expect(response.body.data.options).toEqual([
                { value: 'ORAL', matchCount: 1, vaccineWhodrugId: nullBranchId }
            ]);
        });

        // ESAVI-WHODRUG-006E — the leaf: every option here is a single vaccine
        it('the strengths level closes the walk with one row per option', async () => {
            const response = await navigate('strengths', { abbreviation, drugName: multiName, maHolders: 'BETA', formTranslations: 'INYECTABLE' });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.total).toBe(2);
            expect(response.body.data.options.map(( option: { value: string } ) => option.value)).toEqual(['2 MG', '3 MG']);
            for( const option of response.body.data.options ) {
                expect(option.matchCount).toBe(1);
                expect(option.vaccineWhodrugId).not.toBeNull();
            }
        });

        it('count is the number of options and total the sum of their matchCount', async () => {
            const response = await navigate('ma-holders', { abbreviation, drugName: multiName });

            const { count, total, options } = response.body.data;
            expect(count).toBe(options.length);
            expect(total).toBe(options.reduce(( sum: number, option: { matchCount: number } ) => sum + option.matchCount, 0));
        });

        it('every level requires its immediate parent and answers 400 without it', async () => {
            const levels = [
                ['drug-names', 'Abbreviation is required'],
                ['ma-holders', 'Drug Name is required'],
                ['forms', 'MA Holders is required'],
                ['strengths', 'Form Translations is required']
            ];

            for( const [level, parentMessage] of levels ) {
                const response = await navigate(level, {});

                expect(response.status).toBe(400);
                expect(response.body.ok).toBe(false);
                expect(JSON.stringify(response.body.errors)).toContain(parentMessage);
            }
        });

        it('the immediate parent alone is enough, with no higher ancestor', async () => {
            const response = await navigate('strengths', { formTranslations: 'ORAL', drugName: multiName });

            expect(response.status).toBe(200);
            expect(response.body.data.options).toEqual([
                { value: '4 MG', matchCount: 1, vaccineWhodrugId: nullBranchId }
            ]);
        });

        // The row of a country stays out of the generic subset and comes back in with ?country=,
        // without the generic rows ever leaving
        it('country adds its rows to the generic subset instead of replacing it', async () => {
            const generic = await navigate('drug-names', { abbreviation });
            const withCountry = await navigate('drug-names', { abbreviation, country: 'ECU' });

            expect(generic.body.data.options.map(( option: { value: string } ) => option.value)).not.toContain(countryName);
            expect(withCountry.body.data.count).toBe(3);
            expect(withCountry.body.data.total).toBe(5);
            expect(withCountry.body.data.options.map(( option: { value: string } ) => option.value)).toEqual([multiName, countryName, soloName]);
        });

        it('a country with no rows of its own still answers the generic subset', async () => {
            const response = await navigate('drug-names', { abbreviation, country: 'ZZZ' });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(2);
            expect(response.body.data.total).toBe(4);
        });

        // The search filters the same column that is grouped, so it discards whole groups and never
        // rows inside one: matchCount keeps meaning "rows hanging from this option"
        it('search narrows the level without altering the matchCount of what survives', async () => {
            const response = await navigate('drug-names', { abbreviation, search: 'MULTI' });

            expect(response.status).toBe(200);
            expect(response.body.data.options).toEqual([
                { value: multiName, matchCount: 3, vaccineWhodrugId: null }
            ]);
        });

        it('search treats the two LIKE wildcards as literal text', async () => {
            const response = await navigate('drug-names', { abbreviation, search: 'MULT_' });

            expect(response.status).toBe(200);
            expect(response.body.data.options).toEqual([]);
        });

        it('search under two characters answers 400', async () => {
            const response = await navigate('drug-names', { abbreviation, search: 'M' });

            expect(response.status).toBe(400);
        });

        it('a filter with no match answers 200 with an empty list, not 404', async () => {
            const response = await navigate('drug-names', { abbreviation: `NOTHING${ suffix }` });

            expect(response.status).toBe(200);
            expect(response.body.data).toEqual({ count: 0, total: 0, options: [] });
        });

        it('the literal path is not captured by the getById of the UUID', async () => {
            const response = await request(app).get(`${ base }/abbreviations`).set(authHeader('USER'));

            expect(response.status).toBe(200);
        });

        // Last on purpose: it takes a row out of the branch and every count above it would move
        it('an inactive row disappears from the tree, even for a SUPERADMIN', async () => {
            await request(app).delete(`${ base }/${ soloId }`).set(authHeader('ADMIN'));

            const response = await request(app).get(`${ base }/drug-names`)
                .set(authHeader('SUPERADMIN')).query({ language: 'es', abbreviation });

            expect(response.status).toBe(200);
            expect(response.body.data.options).toEqual([
                { value: multiName, matchCount: 3, vaccineWhodrugId: null }
            ]);
            expect(response.body.data.total).toBe(3);
        });

    });
});
