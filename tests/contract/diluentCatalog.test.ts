import request from 'supertest';
import { app } from '../../src/app';
import { DiluentCatalog } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * Contract suite for SPEC F23 — the seven canonical operations of diluentCatalog.
 *
 * Two things here go beyond the usual walkthrough, and both are named as risks in §7. `code` is
 * normalized with toConstantCase while `name` is only trimmed, so a PUT resending the code the way
 * a human types it must not write — the criterion the five canonical differential ones do not catch
 * by themselves, because the GET already returns the normalized value. And the uniqueness of `code`
 * is global and does not filter by isActive, so a code held by a deactivated row is a 409 and never
 * a 500 from the database.
 */
describe('diluentCatalog contract', () => {

    const base = '/api/diluents';

    // The database is shared by every suite of the run, so the rows of this file are isolated by a
    // suffix in name — which is what `search` filters on — and in code
    const suffix = Date.now().toString(36).toUpperCase();
    let sequence = 0;
    const aCode = ( prefix: string ) => `${ prefix }-${ suffix }-${ ++sequence }`;

    // errorHandler logs every error it handles, and half of these tests trigger errors on purpose,
    // so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createDiluent = ( payload: Record<string, unknown> ) =>
        request(app).post(base).set(authHeader('ADMIN')).send(payload);

    const readRow = async ( id: string ) => {
        const row = await DiluentCatalog.findByPk(id);
        return {
            code: row!.getDataValue('code'),
            name: row!.getDataValue('name'),
            description: row!.getDataValue('description'),
            composition: row!.getDataValue('composition'),
            isActive: row!.getDataValue('isActive'),
            deletedAt: row!.getDataValue('deletedAt'),
            updatedAt: row!.getDataValue('updatedAt'),
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

        let diluentCatalogId: string;

        // ESAVI-DILUENT-001
        it('create responds 201 with the envelope, the code normalized and the name literal', async () => {
            const response = await createDiluent({
                code: `  agua destilada ${ suffix }  `,
                name: '  Cloruro de sodio 0.9%  ',
                description: '  Solución salina isotónica  ',
                composition: '  NaCl 9 mg/mL  '
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            // Trimmed first and then toConstantCase: the code is an identifier the application mints
            expect(response.body.data.code).toBe(`AGUA_DESTILADA_${ suffix }`);
            // Only trimmed, never toTitleCase, which would turn this into 'Cloruro De Sodio 0.9%'
            expect(response.body.data.name).toBe('Cloruro de sodio 0.9%');
            expect(response.body.data.description).toBe('Solución salina isotónica');
            expect(response.body.data.composition).toBe('NaCl 9 mg/mL');
            expect(response.body.data.isActive).toBe(true);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-DILUENT-001');

            diluentCatalogId = response.body.data.diluentCatalogId;
        });

        // ESAVI-DILUENT-003
        it('getById responds 200 with the whole shape of 3.7 and never sysDetails', async () => {
            const response = await request(app)
                .get(`${ base }/${ diluentCatalogId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            // The eleven columns minus sysDetails
            expect(Object.keys(response.body.data).sort()).toEqual([
                'appDetails', 'code', 'composition', 'createdAt', 'deletedAt', 'description',
                'diluentCatalogId', 'isActive', 'name', 'updatedAt'
            ]);
        });

        // ESAVI-DILUENT-002A
        it('the public listing returns count and rows', async () => {
            const response = await request(app)
                .get(`${ base }?search=Cloruro de sodio&limit=100`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('count');
            expect(response.body.data.rows.map(( r: { diluentCatalogId: string } ) => r.diluentCatalogId))
                .toContain(diluentCatalogId);
            expect(response.body.data.rows[0]).not.toHaveProperty('sysDetails');
        });

        // ESAVI-DILUENT-002B
        it('the admin listing returns the same row', async () => {
            const response = await request(app)
                .get(`${ base }/admin?search=Cloruro de sodio&limit=100`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.map(( r: { diluentCatalogId: string } ) => r.diluentCatalogId))
                .toContain(diluentCatalogId);
        });

        // ESAVI-DILUENT-004
        it('update responds 200, normalizes the new code and leaves the name literal', async () => {
            const response = await request(app)
                .put(`${ base }/${ diluentCatalogId }`)
                .set(authHeader('ADMIN'))
                .send({ code: `  agua para inyeccion ${ suffix }  `, name: '  Agua para inyección  ' });

            expect(response.status).toBe(200);
            expect(response.body.data.code).toBe(`AGUA_PARA_INYECCION_${ suffix }`);
            expect(response.body.data.name).toBe('Agua para inyección');
        });

        // ESAVI-DILUENT-005A
        it('delete deactivates, stamps deletedAt and answers without data', async () => {
            const response = await request(app)
                .delete(`${ base }/${ diluentCatalogId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(diluentCatalogId);
            expect(row.isActive).toBe(false);
            expect(row.deletedAt).toBeInstanceOf(Date);
            // Only the operation code, with no _ACTIVATION stuck behind it
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-DILUENT-005A');
        });

        // ESAVI-DILUENT-005B
        it('activate reverses it and answers without data', async () => {
            const response = await request(app)
                .patch(`${ base }/activate/${ diluentCatalogId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(diluentCatalogId);
            expect(row.isActive).toBe(true);
            expect(row.deletedAt).toBeNull();
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-DILUENT-005B');
        });

        it('every write appended to appDetails without erasing the previous ones', async () => {
            const row = await readRow(diluentCatalogId);
            expect(row.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-DILUENT-001',
                'ESAVI-DILUENT-004',
                'ESAVI-DILUENT-005A',
                'ESAVI-DILUENT-005B'
            ]);
        });
    });

    describe('uniqueness of code', () => {

        it('creating the same code twice responds 409 and not 500', async () => {
            const code = aCode('DUP');
            await createDiluent({ code, name: `Dup A ${ suffix }` });

            const response = await createDiluent({ code, name: `Dup B ${ suffix }` });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_001_CODE_EXISTS');
        });

        // The UNIQUE of the DDL knows nothing about isActive, so filtering by it here would turn this
        // 409 into a 500 when the database rejected the INSERT
        it('the check does not filter by isActive: an inactive row still occupies the code', async () => {
            const code = aCode('INACT');
            const created = await createDiluent({ code, name: `Inactive holder ${ suffix }` });
            await request(app).delete(`${ base }/${ created.body.data.diluentCatalogId }`).set(authHeader('ADMIN'));

            const response = await createDiluent({ code, name: `Inactive clash ${ suffix }` });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_001_CODE_EXISTS');
        });

        // The uniqueness is asked about the normalized value, or AGUA_DESTILADA would get in twice
        it('two codes that only differ in case and spacing collide', async () => {
            const code = aCode('CASE');
            await createDiluent({ code, name: `Case A ${ suffix }` });

            const response = await createDiluent({ code: code.toLowerCase().replace(/-/g, ' '), name: `Case B ${ suffix }` });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_001_CODE_EXISTS');
        });

        it('an update to an occupied code responds 409 even when nothing else changes', async () => {
            const taken = aCode('UPD-A');
            await createDiluent({ code: taken, name: `Update holder ${ suffix }` });
            const mine = await createDiluent({ code: aCode('UPD-B'), name: `Update mine ${ suffix }` });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.diluentCatalogId }`)
                .set(authHeader('ADMIN'))
                .send({ code: taken });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_004_CODE_EXISTS');
        });

        it('an update resending its own code is not a collision with itself', async () => {
            const code = aCode('SELF');
            const mine = await createDiluent({ code, name: `Self ${ suffix }` });

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.diluentCatalogId }`)
                .set(authHeader('ADMIN'))
                .send({ code, name: `Self renamed ${ suffix }` });

            expect(response.status).toBe(200);
        });

        it('the code is mutable: an update to a free code writes it', async () => {
            const mine = await createDiluent({ code: aCode('MUT'), name: `Mutable ${ suffix }` });
            const newCode = aCode('MUT-NEW');

            const response = await request(app)
                .put(`${ base }/${ mine.body.data.diluentCatalogId }`)
                .set(authHeader('ADMIN'))
                .send({ code: newCode });

            expect(response.status).toBe(200);
            expect(( await readRow(mine.body.data.diluentCatalogId) ).code).toBe(newCode.toUpperCase().replace(/-/g, '_'));
        });
    });

    describe('validation', () => {

        it('creating without code responds 400', async () => {
            const response = await createDiluent({ name: `No code ${ suffix }` });
            expect(response.status).toBe(400);
        });

        it('creating without name responds 400', async () => {
            const response = await createDiluent({ code: aCode('NO-NAME') });
            expect(response.status).toBe(400);
        });

        it('a search shorter than two characters responds 400 in both listings', async () => {
            expect(( await request(app).get(`${ base }?search=s`).set(authHeader('USER')) ).status).toBe(400);
            expect(( await request(app).get(`${ base }/admin?search=s`).set(authHeader('ADMIN')) ).status).toBe(400);
        });

        it('a limit above 100 responds 400', async () => {
            expect(( await request(app).get(`${ base }?limit=101`).set(authHeader('USER')) ).status).toBe(400);
        });

        it('an id that is not a UUID responds 400', async () => {
            expect(( await request(app).get(`${ base }/not-a-uuid`).set(authHeader('USER')) ).status).toBe(400);
        });
    });

    describe('the listings and their only filter', () => {

        const listSuffix = `FILTER${ suffix }`;
        let activeId: string;
        let inactiveId: string;

        beforeAll(async () => {
            const active = await createDiluent({ code: aCode('F1'), name: `Cloruro de sodio 0.9% ${ listSuffix }` });
            activeId = active.body.data.diluentCatalogId;
            await createDiluent({ code: aCode('F2'), name: `Agua para inyección ${ listSuffix }` });
            await createDiluent({ code: aCode('F3'), name: `Bicarbonato de SODIO ${ listSuffix }` });
            const inactive = await createDiluent({ code: aCode('F4'), name: `Diluyente retirado ${ listSuffix }` });
            inactiveId = inactive.body.data.diluentCatalogId;
            await request(app).delete(`${ base }/${ inactiveId }`).set(authHeader('ADMIN'));
        });

        const publicNames = async ( qs: string ): Promise<string[]> => {
            const response = await request(app).get(`${ base }?${ qs }&limit=100`).set(authHeader('USER'));
            expect(response.status).toBe(200);
            return response.body.data.rows.map(( r: { name: string } ) => r.name);
        };

        const adminNames = async ( qs: string ): Promise<string[]> => {
            const response = await request(app).get(`${ base }/admin?${ qs }&limit=100`).set(authHeader('ADMIN'));
            expect(response.status).toBe(200);
            return response.body.data.rows.map(( r: { name: string } ) => r.name);
        };

        it('search matches any position of name and ignores case', async () => {
            const names = await publicNames(`search=sodio`);
            expect(names).toEqual(expect.arrayContaining([
                `Cloruro de sodio 0.9% ${ listSuffix }`,
                `Bicarbonato de SODIO ${ listSuffix }`
            ]));
        });

        it('the public listing hides the inactive row and the admin listing shows it', async () => {
            expect(await publicNames(`search=${ listSuffix }`)).not.toContain(`Diluyente retirado ${ listSuffix }`);
            expect(await adminNames(`search=${ listSuffix }`)).toContain(`Diluyente retirado ${ listSuffix }`);
        });

        it('the default order is name ASC', async () => {
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
            // canViewInactive is SUPERADMIN-only while 002B is ADMIN: the asymmetry is deliberate and
            // is the same one healthFacility, diagnosticTerm and vaccineWhodrug already have
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('USER')) ).status).toBe(404);
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('ADMIN')) ).status).toBe(404);
            expect(( await request(app).get(`${ base }/${ inactiveId }`).set(authHeader('SUPERADMIN')) ).status).toBe(200);
        });

        it('an unknown id responds 404 with the operation code', async () => {
            const response = await request(app)
                .get(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('DILUENT_003_NOT_FOUND');
        });

        it('the active row is still reachable by id', async () => {
            expect(( await request(app).get(`${ base }/${ activeId }`).set(authHeader('USER')) ).status).toBe(200);
        });

        // SPEC F52 — name and code become the canonical parameters, search survives as their alias
        describe('canonical name/code parameters — SPEC F52', () => {

            const codeSuffix = `CODE${ suffix }`;
            let byCodeId: string;

            beforeAll(async () => {
                const created = await createDiluent({ code: `LOOKUP_${ codeSuffix }`, name: `Lookup by code ${ suffix }` });
                byCodeId = created.body.data.diluentCatalogId;
                await createDiluent({ code: `WILD_A_${ suffix }`, name: `Wildcard probe ${ suffix }` });
                await createDiluent({ code: `WILDXA_${ suffix }`, name: `Wildcard probe twin ${ suffix }` });
            });

            it('name matches partially over the name column', async () => {
                const names = await publicNames(`name=sodio`);
                expect(names).toEqual(expect.arrayContaining([`Cloruro de sodio 0.9% ${ listSuffix }`]));
            });

            it('code matches partially over the code column', async () => {
                const response = await request(app).get(`${ base }?code=lookup_${ codeSuffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { diluentCatalogId: string }) => r.diluentCatalogId)).toEqual([byCodeId]);
            });

            it('name and code combine with Op.or — a match on either is enough', async () => {
                const response = await request(app)
                    .get(`${ base }?name=noExisteEsteNombre${ suffix }&code=lookup_${ codeSuffix }&limit=100`)
                    .set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { diluentCatalogId: string }) => r.diluentCatalogId)).toContain(byCodeId);
            });

            it('explicit name wins over search when both arrive', async () => {
                const response = await request(app)
                    .get(`${ base }?name=Agua para inyección ${ listSuffix }&search=sodio&limit=100`)
                    .set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { name: string }) => r.name)).toEqual([`Agua para inyección ${ listSuffix }`]);
            });

            it('search keeps covering both name and code, now also matching by code', async () => {
                const response = await request(app).get(`${ base }?search=lookup_${ codeSuffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                expect(response.body.data.rows.map((r: { diluentCatalogId: string }) => r.diluentCatalogId)).toContain(byCodeId);
            });

            it('a literal underscore in code does not act as a single-character wildcard', async () => {
                const response = await request(app).get(`${ base }?code=WILD_A_${ suffix }&limit=100`).set(authHeader('USER'));
                expect(response.status).toBe(200);
                const codes = response.body.data.rows.map((r: { code: string }) => r.code);
                expect(codes).toContain(`WILD_A_${ suffix }`);
                expect(codes).not.toContain(`WILDXA_${ suffix }`);
            });

        });
    });

    describe('differential update', () => {

        let id: string;
        let code: string;

        beforeEach(async () => {
            code = aCode('DIFF');
            const created = await createDiluent({
                code,
                name: `Differential ${ suffix } ${ sequence }`,
                description: 'first description',
                composition: 'first composition'
            });
            id = created.body.data.diluentCatalogId;
        });

        const put = ( payload: Record<string, unknown> ) =>
            request(app).put(`${ base }/${ id }`).set(authHeader('ADMIN')).send(payload);

        it('a PUT resending the whole GET response writes nothing', async () => {
            await expectPutOfGetResponseWritesNothing({ path: base, id, model: DiluentCatalog });
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

            const response = await put({ name: `Differential renamed ${ suffix }` });

            expect(response.status).toBe(200);
            const after = await readRow(id);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.appDetails.at(-1)!.method).toBe('ESAVI-DILUENT-004');
            expect(after.version).toBe(before.version! + 1);
        });

        // The risk §7 puts first, and the one the five canonical criteria do not catch: the GET
        // returns the code already normalized, so resending it whole passes without proving anything
        it('a PUT with the code unnormalized over the stored one writes nothing', async () => {
            const before = await readRow(id);

            const response = await put({ code: code.toLowerCase().replace(/-/g, ' ') });

            expect(response.status).toBe(200);
            const after = await readRow(id);
            expect(after.code).toBe(before.code);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(after.version).toBe(before.version);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('isActive in the body responds 200 and does not deactivate the row', async () => {
            const response = await put({ isActive: false });

            expect(response.status).toBe(200);
            expect(( await readRow(id) ).isActive).toBe(true);
        });

        it('an unknown id responds 404 with the operation code', async () => {
            const response = await request(app)
                .put(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('ADMIN'))
                .send({ name: 'whatever' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('DILUENT_004_NOT_FOUND');
        });

        describe('the nullable columns', () => {

            it('description null empties the column and description "" stores the empty string', async () => {
                await put({ description: null });
                expect(( await readRow(id) ).description).toBeNull();

                await put({ description: '' });
                expect(( await readRow(id) ).description).toBe('');
            });

            it('composition null empties the column', async () => {
                const response = await put({ composition: null });

                expect(response.status).toBe(200);
                expect(( await readRow(id) ).composition).toBeNull();
            });

            it('a PUT without the composition key leaves the column as it was', async () => {
                const before = await readRow(id);

                await put({ name: `Untouched composition ${ suffix }` });

                expect(( await readRow(id) ).composition).toBe(before.composition);
            });
        });
    });

    describe('activation', () => {

        let id: string;

        beforeEach(async () => {
            const created = await createDiluent({
                code: aCode('ACT'),
                name: `Activation ${ suffix } ${ sequence }`
            });
            id = created.body.data.diluentCatalogId;
        });

        it('deactivating twice responds 409', async () => {
            await request(app).delete(`${ base }/${ id }`).set(authHeader('ADMIN'));

            const response = await request(app).delete(`${ base }/${ id }`).set(authHeader('ADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_005A_ALREADY_INACTIVE');
        });

        it('activating what is already active responds 409', async () => {
            const response = await request(app).patch(`${ base }/activate/${ id }`).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DILUENT_005B_ALREADY_ACTIVE');
        });

        it('deleting an unknown id responds 404', async () => {
            const response = await request(app)
                .delete(`${ base }/11111111-1111-4111-8111-111111111111`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('DILUENT_005A_NOT_FOUND');
        });
    });
});
