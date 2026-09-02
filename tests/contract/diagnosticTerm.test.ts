import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import { sequelize } from '../../src/database/connection';
import { DiagnosticTerm } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import { resolveDiagnosticTermService } from '../../src/services/common/diagnosticTermResolution.service';

/**
 * Contract suite for SPEC F15 — the seven canonical operations of diagnosticTerm plus the
 * non-canonical ESAVI-DIAGTERM-006, which has no HTTP route and is therefore exercised by calling
 * the service directly.
 *
 * Three things here are unique in the repository and are the reason the suite goes beyond the
 * usual walkthrough: uniqueness is by the `(source, code)` pair and not global, `Op.iLike` is
 * introduced for the first time, and `metadata.reviewStatus` is the first filter over a JSONB key.
 */
describe('diagnosticTerm contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // errorHandler logs every error it handles, and half of these tests trigger errors on purpose,
    // so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createTerm = ( payload: Record<string, unknown> ) =>
        request(app).post('/api/diagnostic-terms').set(authHeader('ADMIN')).send(payload);

    const readRow = async ( id: string ) => {
        const row = await DiagnosticTerm.findByPk(id);
        return {
            name: row!.getDataValue('name'),
            code: row!.getDataValue('code'),
            isActive: row!.getDataValue('isActive'),
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

        let diagnosticTermId: string;

        // ESAVI-DIAGTERM-001
        it('create responds 201 with the envelope and the normalized entity', async () => {
            const response = await createTerm({
                code: `  lifecycle-${ suffix }  `,
                name: `  dolor de cabeza ${ suffix }  `,
                termGroup: '  Neurologico  '
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data.code).toBe(`LIFECYCLE_${ suffix }`);
            // Only trimmed, never toTitleCase: a dictionary term is quoted data
            expect(response.body.data.name).toBe(`dolor de cabeza ${ suffix }`);
            expect(response.body.data.termGroup).toBe('Neurologico');
            expect(response.body.data.source).toBe('LOCAL');
            expect(response.body.data.isActive).toBe(true);
            // An administrative entry carries no markers
            expect(response.body.data.metadata).toEqual({});
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-DIAGTERM-001');

            diagnosticTermId = response.body.data.diagnosticTermId;
        });

        // ESAVI-DIAGTERM-003
        it('getById responds 200 with the whole shape of 3.7 and never sysDetails', async () => {
            const response = await request(app)
                .get(`/api/diagnostic-terms/${ diagnosticTermId }`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(Object.keys(response.body.data).sort()).toEqual([
                'appDetails', 'code', 'createdAt', 'deletedAt', 'diagnosticTermId',
                'isActive', 'metadata', 'name', 'source', 'termGroup', 'updatedAt'
            ]);
        });

        // ESAVI-DIAGTERM-002A
        it('the public listing returns count and rows', async () => {
            const response = await request(app)
                .get(`/api/diagnostic-terms?search=${ suffix }&limit=100`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('count');
            expect(response.body.data.rows.map((r: { diagnosticTermId: string }) => r.diagnosticTermId))
                .toContain(diagnosticTermId);
            expect(response.body.data.rows[0]).not.toHaveProperty('sysDetails');
        });

        // ESAVI-DIAGTERM-002B
        it('the admin listing returns the same row', async () => {
            const response = await request(app)
                .get(`/api/diagnostic-terms/admin?search=${ suffix }&limit=100`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.map((r: { diagnosticTermId: string }) => r.diagnosticTermId))
                .toContain(diagnosticTermId);
        });

        // ESAVI-DIAGTERM-004
        it('update responds 200 and normalizes the new code', async () => {
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ diagnosticTermId }`)
                .set(authHeader('ADMIN'))
                .send({ code: `  lifecycle-renamed-${ suffix }  `, name: `  Cefalea tensional ${ suffix }  ` });

            expect(response.status).toBe(200);
            expect(response.body.data.code).toBe(`LIFECYCLE_RENAMED_${ suffix }`);
            expect(response.body.data.name).toBe(`Cefalea tensional ${ suffix }`);
        });

        // ESAVI-DIAGTERM-005A
        it('delete deactivates, stamps deletedAt and answers without data', async () => {
            const response = await request(app)
                .delete(`/api/diagnostic-terms/${ diagnosticTermId }`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(diagnosticTermId);
            expect(row.isActive).toBe(false);
            expect(row.deletedAt).toBeInstanceOf(Date);
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-DIAGTERM-005A');
        });

        // ESAVI-DIAGTERM-005B
        it('activate reverses it and answers without data', async () => {
            const response = await request(app)
                .patch(`/api/diagnostic-terms/activate/${ diagnosticTermId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ ok: true, message: expect.any(String) });

            const row = await readRow(diagnosticTermId);
            expect(row.isActive).toBe(true);
            expect(row.deletedAt).toBeNull();
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-DIAGTERM-005B');
        });

        it('every write appended to appDetails without erasing the previous ones', async () => {
            const row = await readRow(diagnosticTermId);
            expect(row.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-DIAGTERM-001',
                'ESAVI-DIAGTERM-004',
                'ESAVI-DIAGTERM-005A',
                'ESAVI-DIAGTERM-005B'
            ]);
        });
    });

    describe('uniqueness of the (source, code) pair', () => {

        it('a repeated pair responds 409 on create, not 500', async () => {
            const code = `DUP_${ suffix }`;
            expect((await createTerm({ code, name: 'Primero' })).status).toBe(201);

            const repeated = await createTerm({ code, name: 'Segundo' });
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('DIAGTERM_001_CODE_EXISTS');
        });

        it('the same code under a different source responds 201: uniqueness is by pair', async () => {
            const response = await createTerm({ source: 'MEDDRA', code: `DUP_${ suffix }`, name: 'Otra fuente' });
            expect(response.status).toBe(201);
            expect(response.body.data.source).toBe('MEDDRA');
        });

        it('a repeated pair responds 409 even when the stored row is inactive', async () => {
            const code = `DUPOFF_${ suffix }`;
            const first = await createTerm({ code, name: 'Inactivo', isActive: false });
            expect(first.body.data.isActive).toBe(false);

            const repeated = await createTerm({ code, name: 'Choca igual' });
            expect(repeated.status).toBe(409);
        });

        it('an occupied code responds 409 on update, before and independently of the diff', async () => {
            const target = await createTerm({ code: `FREE_${ suffix }`, name: 'Libre' });
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ target.body.data.diagnosticTermId }`)
                .set(authHeader('ADMIN'))
                .send({ code: `DUP_${ suffix }` });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('DIAGTERM_004_CODE_EXISTS');
        });
    });

    describe('input validation', () => {

        it('create without code responds 400', async () => {
            expect((await createTerm({ name: 'Sin codigo' })).status).toBe(400);
        });

        it('create with a source outside the enum responds 400', async () => {
            expect((await createTerm({ code: `BAD_${ suffix }`, name: 'X', source: 'FAKE' })).status).toBe(400);
        });

        it('a one character search responds 400 and a two character one does not', async () => {
            expect((await request(app).get('/api/diagnostic-terms?search=c').set(authHeader('USER'))).status).toBe(400);
            expect((await request(app).get('/api/diagnostic-terms?search=ce').set(authHeader('USER'))).status).toBe(200);
        });

        it('a limit above 100 responds 400', async () => {
            expect((await request(app).get('/api/diagnostic-terms?limit=500').set(authHeader('USER'))).status).toBe(400);
        });

        it('an id that is not a UUID responds 400', async () => {
            expect((await request(app).get('/api/diagnostic-terms/not-a-uuid').set(authHeader('USER'))).status).toBe(400);
        });

        it('a nonexistent id responds 404 on getById, update and delete', async () => {
            const missing = '6f7a7e5a-0000-4000-8000-000000000000';

            const fetched = await request(app).get(`/api/diagnostic-terms/${ missing }`).set(authHeader('USER'));
            expect(fetched.status).toBe(404);
            expect(fetched.body.code).toBe('DIAGTERM_003_NOT_FOUND');

            const updated = await request(app).put(`/api/diagnostic-terms/${ missing }`).set(authHeader('ADMIN')).send({ name: 'X' });
            expect(updated.body.code).toBe('DIAGTERM_004_NOT_FOUND');

            const deleted = await request(app).delete(`/api/diagnostic-terms/${ missing }`).set(authHeader('ADMIN'));
            expect(deleted.body.code).toBe('DIAGTERM_005A_NOT_FOUND');
        });
    });

    describe('listings, search and filters', () => {

        beforeAll(async () => {
            await createTerm({ code: `SRCH1_${ suffix }`, name: `Cefalea ${ suffix }`, termGroup: `Neuro${ suffix }` });
            await createTerm({ code: `SRCH2_${ suffix }`, name: `Dolor cefálico ${ suffix }`, termGroup: `Neuro${ suffix }` });
            await createTerm({ code: `SRCH3_${ suffix }`, name: `Fiebre ${ suffix }`, source: 'MEDDRA', termGroup: 'General' });
            await createTerm({ code: `SRCH4_${ suffix }`, name: `Cefalea retirada ${ suffix }`, isActive: false });
            await createTerm({ code: `US_${ suffix }A`, name: `Wildcard probe ${ suffix }` });
            await createTerm({ code: `USX${ suffix }A`, name: `Wildcard probe twin ${ suffix }` });
        });

        const publicList = ( qs: string ) =>
            request(app).get(`/api/diagnostic-terms${ qs }`).set(authHeader('USER'));

        const adminList = ( qs: string ) =>
            request(app).get(`/api/diagnostic-terms/admin${ qs }`).set(authHeader('ADMIN'));

        it('search matches partially and case insensitively over name', async () => {
            const response = await publicList(`?search=cef&limit=100`);
            const names = response.body.data.rows.map((r: { name: string }) => r.name);

            expect(names).toContain(`Cefalea ${ suffix }`);
            expect(names).toContain(`Dolor cefálico ${ suffix }`);
        });

        it('the public listing hides inactive rows and the admin one shows them', async () => {
            const asUser = await publicList(`?search=${ suffix }&limit=100`);
            const asAdmin = await adminList(`?search=${ suffix }&limit=100`);

            const userNames = asUser.body.data.rows.map((r: { name: string }) => r.name);
            const adminNames = asAdmin.body.data.rows.map((r: { name: string }) => r.name);

            expect(userNames).not.toContain(`Cefalea retirada ${ suffix }`);
            expect(adminNames).toContain(`Cefalea retirada ${ suffix }`);
        });

        it('source filters by equality and termGroup admits no partial match', async () => {
            const bySource = await publicList(`?source=MEDDRA&search=${ suffix }&limit=100`);
            expect(bySource.body.data.rows.every((r: { source: string }) => r.source === 'MEDDRA')).toBe(true);

            const byGroup = await publicList(`?termGroup=Neuro${ suffix }&search=${ suffix }&limit=100`);
            expect(byGroup.body.data.rows).toHaveLength(2);

            const partial = await publicList(`?termGroup=Neuro&search=${ suffix }&limit=100`);
            expect(partial.body.data.rows).toHaveLength(0);
        });

        it('both listings order by name ASC', async () => {
            const response = await adminList(`?search=${ suffix }&limit=100`);
            const names = response.body.data.rows.map((r: { name: string }) => r.name);

            expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b, 'en')));
        });

        it('reviewStatus filters over the JSONB key in the admin listing and does not exist in the public one', async () => {
            await DiagnosticTerm.create({
                source: 'LOCAL', code: `REV_${ suffix }`, name: `Pendiente ${ suffix }`,
                metadata: { autoCreated: true, createdFrom: 'ESAVI-TEST-001', reviewStatus: 'PENDING' }
            });

            const filtered = await adminList(`?reviewStatus=PENDING&search=${ suffix }&limit=100`);
            expect(filtered.body.data.rows).toHaveLength(1);
            expect(filtered.body.data.rows[0].name).toBe(`Pendiente ${ suffix }`);

            const missing = await adminList(`?reviewStatus=REJECTED&search=${ suffix }&limit=100`);
            expect(missing.body.data.rows).toHaveLength(0);

            // The public listing ignores the parameter instead of honouring it
            const ignored = await publicList(`?reviewStatus=PENDING&search=${ suffix }&limit=100`);
            expect(ignored.body.data.rows.length).toBeGreaterThan(1);
        });

        it('the literal /admin path is not captured as an :id', async () => {
            const response = await adminList('');
            expect(response.status).toBe(200);
            expect(response.body.data).toHaveProperty('rows');
        });

        // SPEC F52 — name and code become the canonical parameters, search survives as their alias
        describe('canonical name/code parameters — SPEC F52', () => {

            it('name matches partially and case insensitively over the name column', async () => {
                const response = await publicList(`?name=cefalea ${ suffix }&limit=100`);
                const names = response.body.data.rows.map((r: { name: string }) => r.name);

                expect(names).toContain(`Cefalea ${ suffix }`);
                expect(names).not.toContain(`Fiebre ${ suffix }`);
            });

            it('code matches partially and case insensitively over the code column', async () => {
                const response = await publicList(`?code=srch2_${ suffix }&limit=100`);
                const names = response.body.data.rows.map((r: { name: string }) => r.name);

                expect(names).toEqual([`Dolor cefálico ${ suffix }`]);
            });

            it('name and code combine with Op.or — a match on either is enough', async () => {
                const response = await publicList(`?name=noExisteEsteTermino${ suffix }&code=SRCH3_${ suffix }&limit=100`);
                const codes = response.body.data.rows.map((r: { code: string }) => r.code);

                expect(codes).toContain(`SRCH3_${ suffix }`);
            });

            it('explicit name wins over search when both arrive', async () => {
                // search stays fully suffixed so its fallback over the code column cannot pick up
                // an unrelated row from another suite's fixtures sharing this database
                const response = await publicList(`?name=Fiebre ${ suffix }&search=Cefalea ${ suffix }&limit=100`);
                const names = response.body.data.rows.map((r: { name: string }) => r.name);

                expect(names).toEqual([`Fiebre ${ suffix }`]);
            });

            it('search keeps covering both name and code, now also matching by code', async () => {
                const response = await publicList(`?search=SRCH3_${ suffix }&limit=100`);
                const codes = response.body.data.rows.map((r: { code: string }) => r.code);

                expect(codes).toContain(`SRCH3_${ suffix }`);
            });

            it('a literal underscore in code does not act as a single-character wildcard', async () => {
                const response = await publicList(`?code=US_${ suffix }A&limit=100`);
                const codes = response.body.data.rows.map((r: { code: string }) => r.code);

                expect(codes).toContain(`US_${ suffix }A`);
                expect(codes).not.toContain(`USX${ suffix }A`);
            });

        });
    });

    /**
     * SPEC F12 — a PUT is not "save what I send", it is "leave the record in this state". The
     * first case is the one that really discriminates: it resends the GET response whole, which a
     * service that only looks at key presence would fail.
     */
    describe('differential update', () => {

        let termId: string;

        beforeAll(async () => {
            const created = await createTerm({ code: `DIFF_${ suffix }`, name: `Diferencial ${ suffix }`, termGroup: 'Diferencial' });
            termId = created.body.data.diagnosticTermId;
        });

        it('a PUT resending the whole GET response writes nothing', async () => {
            await expectPutOfGetResponseWritesNothing({
                path: '/api/diagnostic-terms',
                id: termId,
                model: DiagnosticTerm
            });
        });

        it('a PUT with an empty body behaves the same way', async () => {
            const before = await readRow(termId);
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({});

            expect(response.status).toBe(200);

            const after = await readRow(termId);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(after.version).toBe(before.version);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('a PUT changing a single field adds one entry and bumps the version by 1', async () => {
            const before = await readRow(termId);
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({ name: `Diferencial renombrado ${ suffix }` });

            expect(response.status).toBe(200);

            const after = await readRow(termId);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.appDetails.at(-1)!.method).toBe('ESAVI-DIAGTERM-004');
            expect(after.version).toBe(( before.version as number ) + 1);
        });

        it('resending an already normalized code writes nothing', async () => {
            const before = await readRow(termId);
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({ code: `  diff-${ suffix }  ` });

            expect(response.status).toBe(200);
            expect(response.body.data.code).toBe(`DIFF_${ suffix }`);

            const after = await readRow(termId);
            expect(after.version).toBe(before.version);
        });

        it('source is immutable and ignored in silence, without a 400', async () => {
            const before = await readRow(termId);
            const response = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({ source: 'MEDDRA' });

            expect(response.status).toBe(200);
            expect(response.body.data.source).toBe('LOCAL');

            const after = await readRow(termId);
            expect(after.version).toBe(before.version);
        });

        it('termGroup: null empties the column and omitting the key leaves it untouched', async () => {
            const emptied = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({ termGroup: null });

            expect(emptied.body.data.termGroup).toBeNull();

            const before = await readRow(termId);
            const untouched = await request(app)
                .put(`/api/diagnostic-terms/${ termId }`)
                .set(authHeader('ADMIN'))
                .send({ name: `Diferencial renombrado ${ suffix }` });

            expect(untouched.body.data.termGroup).toBeNull();
            expect(( await readRow(termId) ).version).toBe(before.version);
        });

        it('reviewStatus is merged over the stored metadata and resending it writes nothing', async () => {
            const auto = await DiagnosticTerm.create({
                source: 'LOCAL', code: `META_${ suffix }`, name: `Autogenerado ${ suffix }`,
                metadata: { autoCreated: true, createdFrom: 'ESAVI-TEST-001', reviewStatus: 'PENDING' }
            });
            const autoId = auto.getDataValue('diagnosticTermId');

            const approved = await request(app)
                .put(`/api/diagnostic-terms/${ autoId }`)
                .set(authHeader('ADMIN'))
                .send({ reviewStatus: 'APPROVED' });

            expect(approved.body.data.metadata).toEqual({
                autoCreated: true,
                createdFrom: 'ESAVI-TEST-001',
                reviewStatus: 'APPROVED'
            });

            const before = await readRow(autoId);
            await request(app)
                .put(`/api/diagnostic-terms/${ autoId }`)
                .set(authHeader('ADMIN'))
                .send({ reviewStatus: 'APPROVED' });

            expect(( await readRow(autoId) ).version).toBe(before.version);
        });
    });

    describe('activation', () => {

        let termId: string;

        beforeAll(async () => {
            const created = await createTerm({ code: `ACTIV_${ suffix }`, name: `Activacion ${ suffix }` });
            termId = created.body.data.diagnosticTermId;
        });

        it('deactivating twice responds 409 ALREADY_INACTIVE', async () => {
            await request(app).delete(`/api/diagnostic-terms/${ termId }`).set(authHeader('ADMIN'));

            const repeated = await request(app).delete(`/api/diagnostic-terms/${ termId }`).set(authHeader('ADMIN'));
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('DIAGTERM_005A_ALREADY_INACTIVE');
        });

        /**
         * `canViewInactive` is SUPERADMIN only (`permissions.helper.ts`), so ADMIN gets the same
         * 404 as USER even though the admin listing does show the row. Same asymmetry
         * healthFacility already carries.
         */
        it.each(['USER', 'ADMIN'] as const)('getById of an inactive term responds 404 for %s', async ( role ) => {
            const response = await request(app).get(`/api/diagnostic-terms/${ termId }`).set(authHeader(role));
            expect(response.status).toBe(404);
        });

        it('getById of an inactive term responds 200 for SUPERADMIN', async () => {
            const response = await request(app).get(`/api/diagnostic-terms/${ termId }`).set(authHeader('SUPERADMIN'));
            expect(response.status).toBe(200);
            expect(response.body.data.isActive).toBe(false);
        });

        it('reactivating twice responds 409 ALREADY_ACTIVE', async () => {
            await request(app).patch(`/api/diagnostic-terms/activate/${ termId }`).set(authHeader('SUPERADMIN'));

            const repeated = await request(app)
                .patch(`/api/diagnostic-terms/activate/${ termId }`)
                .set(authHeader('SUPERADMIN'));

            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('DIAGTERM_005B_ALREADY_ACTIVE');
        });

        it('deactivating consults no child table: an inactive term is still referenced by design', async () => {
            const response = await request(app).delete(`/api/diagnostic-terms/${ termId }`).set(authHeader('ADMIN'));
            expect(response.status).toBe(200);
        });
    });

    /**
     * ESAVI-DIAGTERM-006 — implicit resolution. It has no route, so the service is called
     * directly. Four branches: normalize, match, create marked, and the unique-violation race.
     */
    describe('implicit resolution', () => {

        const authUser = { userId: 'resolution-test' } as never;

        it('a new code creates the row marked as autogenerated', async () => {
            const term = await resolveDiagnosticTermService(
                { code: `RES_${ suffix }`, name: 'Cefalea intensa', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es'
            );

            expect(term.getDataValue('source')).toBe('LOCAL');
            expect(term.getDataValue('metadata')).toEqual({
                autoCreated: true,
                createdFrom: 'ESAVI-NOTEVENT-001',
                reviewStatus: 'PENDING'
            });

            const row = await readRow(term.getDataValue('diagnosticTermId'));
            expect(row.appDetails.at(-1)!.method).toBe('ESAVI-DIAGTERM-006');
            expect(row.appDetails.at(-1)!.user).toBe('resolution-test');
        });

        it('the autogenerated term shows up in the admin listing filtered by PENDING', async () => {
            const response = await request(app)
                .get(`/api/diagnostic-terms/admin?reviewStatus=PENDING&search=Cefalea intensa`)
                .set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows.length).toBeGreaterThan(0);
        });

        it('an existing code returns the stored row without writing, even with a different name', async () => {
            const id = ( await DiagnosticTerm.findOne({ where: { code: `RES_${ suffix }` } }) )!
                .getDataValue('diagnosticTermId');
            const before = await readRow(id);

            const term = await resolveDiagnosticTermService(
                { code: `RES_${ suffix }`, name: 'NOMBRE COMPLETAMENTE DISTINTO', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es'
            );

            expect(term.getDataValue('diagnosticTermId')).toBe(id);

            const after = await readRow(id);
            expect(after.name).toBe(before.name);
            expect(after.updatedAt).toEqual(before.updatedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('the resolver normalizes the code exactly like ESAVI-DIAGTERM-001', async () => {
            const created = await createTerm({ code: `11002-10115-${ suffix }`, name: 'Creado por el CRUD' });
            expect(created.body.data.code).toBe(`11002_10115_${ suffix }`);

            const term = await resolveDiagnosticTermService(
                { code: `  11002-10115-${ suffix }  `, name: 'Da igual', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es'
            );

            expect(term.getDataValue('diagnosticTermId')).toBe(created.body.data.diagnosticTermId);
        });

        it('an inactive code is returned as is, without reactivating it or creating a new row', async () => {
            const created = await createTerm({ code: `RESOFF_${ suffix }`, name: 'Retirado' });
            await request(app)
                .delete(`/api/diagnostic-terms/${ created.body.data.diagnosticTermId }`)
                .set(authHeader('ADMIN'));

            const term = await resolveDiagnosticTermService(
                { code: `RESOFF_${ suffix }`, name: 'Retirado', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es'
            );

            expect(term.getDataValue('diagnosticTermId')).toBe(created.body.data.diagnosticTermId);
            expect(term.getDataValue('isActive')).toBe(false);
            expect(await DiagnosticTerm.count({ where: { code: `RESOFF_${ suffix }` } })).toBe(1);
        });

        it('a rollback of the caller undoes the created term', async () => {
            const transaction = await sequelize.transaction();

            const term = await resolveDiagnosticTermService(
                { code: `RESROLL_${ suffix }`, name: 'Se revierte', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es', transaction
            );
            expect(term.getDataValue('code')).toBe(`RESROLL_${ suffix }`);

            await transaction.rollback();
            expect(await DiagnosticTerm.count({ where: { code: `RESROLL_${ suffix }` } })).toBe(0);
        });

        it('two concurrent resolutions of the same new code end with a single row', async () => {
            const code = `RESRACE_${ suffix }`;

            const results = await Promise.allSettled([
                resolveDiagnosticTermService({ code, name: 'Carrera A', operationCode: 'ESAVI-NOTEVENT-001' }, authUser, 'es'),
                resolveDiagnosticTermService({ code, name: 'Carrera B', operationCode: 'ESAVI-NOTEVENT-001' }, authUser, 'es')
            ]);

            expect(results.every(r => r.status === 'fulfilled')).toBe(true);
            expect(await DiagnosticTerm.count({ where: { code } })).toBe(1);

            const ids = results.map(r => ( r as PromiseFulfilledResult<DiagnosticTerm> ).value.getDataValue('diagnosticTermId'));
            expect(ids[0]).toBe(ids[1]);
        });

        /**
         * The losing INSERT collides while the caller's transaction is open. Without the SAVEPOINT
         * around the create, the violation aborts that transaction and every later statement of
         * the block — the re-read included — is rejected by Postgres.
         * The first findOne is forced to answer null, which is exactly the window the unique index
         * arbitrates: the SELECT saw nothing and the INSERT collides anyway.
         */
        it('branch 4 answers with the caller transaction still open', async () => {
            const code = `RESTX_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Ganador' });

            const realFindOne = DiagnosticTerm.findOne.bind(DiagnosticTerm);
            let calls = 0;
            const spy = jest.spyOn(DiagnosticTerm, 'findOne').mockImplementation(async ( ...args ) => {
                calls++;
                if( calls === 1 ) return null;
                return realFindOne(...args as Parameters<typeof realFindOne>);
            });

            const transaction = await sequelize.transaction();
            const term = await resolveDiagnosticTermService(
                { code, name: 'Perdedor', operationCode: 'ESAVI-NOTEVENT-001' },
                authUser, 'es', transaction
            );
            spy.mockRestore();

            expect(calls).toBe(2);
            expect(term.getDataValue('name')).toBe('Ganador');

            await transaction.commit();
            expect(await DiagnosticTerm.count({ where: { code } })).toBe(1);
        });
    });

    /**
     * SPEC F17 — ESAVI-DIAGTERM-007, bulk import from a MedDRA .asc file. It is the only operation
     * of the entity that speaks multipart/form-data, the only one that answers with the report of a
     * process instead of a resource, and the only one that writes isActive out of the file.
     *
     * The fixture has six lines on purpose: two current, one withdrawn with 'N', one repeating a
     * code already seen, one with no name and one with a single field. That is read: 6,
     * inserted: 3, invalid: 2, duplicated: 1.
     */
    describe('bulk import — ESAVI-DIAGTERM-007', () => {

        const fixturePath = path.resolve(__dirname, '../fixtures/meddra-llt-sample.asc');

        // The fixture codes, so the assertions read as what they are
        const currentCode = '10099001';
        const renamedCode = '10099002';
        const withdrawnCode = '10099003';

        const importFile = ( role: string = 'SUPERADMIN' ) =>
            request(app).post('/api/diagnostic-terms/import').set(authHeader(role));

        // Earlier blocks of this suite leave MEDDRA rows of their own behind, so every count here
        // is scoped to the three codes of the fixture
        const countFixtureRows = () =>
            DiagnosticTerm.count({ where: { source: 'MEDDRA', code: [currentCode, renamedCode, withdrawnCode] } });

        const readByCode = async ( code: string ) => {
            const row = await DiagnosticTerm.findOne({ where: { source: 'MEDDRA', code } });
            return {
                name: row!.getDataValue('name'),
                termGroup: row!.getDataValue('termGroup'),
                isActive: row!.getDataValue('isActive'),
                deletedAt: row!.getDataValue('deletedAt'),
                updatedAt: row!.getDataValue('updatedAt'),
                metadata: row!.getDataValue('metadata') as Record<string, unknown>,
                appDetails: ( row!.getDataValue('appDetails') as { method: string }[] ).length,
                version: ( row!.getDataValue('sysDetails') as { version?: number } ).version
            };
        };

        // The three lines the fixture imports, rebuilt in memory so a variant can change one field
        const buildFile = ( withdrawnFlag: string = 'N', renamedName: string = 'Déficit de 11-beta-hidroxilasa' ) =>
            Buffer.from([
                `${ currentCode }$Fiebre posvacunal$${ currentCode }$$$$$$$Y$$`,
                `${ renamedCode }$${ renamedName }$${ renamedCode }$$$$$$$Y$$`,
                `${ withdrawnCode }$Término retirado por MedDRA$${ withdrawnCode }$$$$$$$${ withdrawnFlag }$$`
            ].join('\n'), 'utf8');

        it('rejects ADMIN with 403 — the widest write of the repository is SUPERADMIN only', async () => {
            const response = await importFile('ADMIN').attach('file', fixturePath);

            expect(response.status).toBe(403);
        });

        it('responds 400 when no file travels', async () => {
            const response = await importFile();

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe('DIAGTERM_007_FILE_REQUIRED');
        });

        it('responds 400 when the file yields no valid line', async () => {
            const response = await importFile()
                .attach('file', Buffer.from('sin;separador\notra;linea', 'utf8'), 'bad.asc');

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('DIAGTERM_007_FILE_INVALID');
        });

        // dryRun runs before the real import on purpose: it is the only moment the table is
        // guaranteed empty of these codes, so "wrote nothing" can be asserted without ambiguity
        it('dryRun reports the same numbers and writes nothing', async () => {
            const response = await importFile().field('dryRun', 'true').attach('file', fixturePath);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                read: 6, inserted: 3, updated: 0, unchanged: 0, invalid: 2, duplicated: 1, dryRun: true
            });
            expect(await countFixtureRows()).toBe(0);
        });

        it('responds 200 with the process report and writes only the valid rows', async () => {
            const response = await importFile()
                .field('dictionaryVersion', '28.0')
                .attach('file', fixturePath);

            // 200 and not 201: there is no resource to point at, only the report of a process
            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.message.length).toBeGreaterThan(0);
            expect(response.body.data).toMatchObject({
                read: 6, inserted: 3, updated: 0, unchanged: 0, invalid: 2, duplicated: 1,
                dryRun: false, source: 'MEDDRA', termGroup: 'LLT'
            });
            // Not a single diagnosticTermId comes back
            expect(JSON.stringify(response.body.data)).not.toContain('diagnosticTermId');
            // The rejected sample carries the line number and the reason of each one
            expect(response.body.data.errors).toEqual([
                { line: 4, reason: 'DUPLICATE_IN_FILE', raw: expect.any(String) },
                { line: 5, reason: 'EMPTY_NAME', raw: expect.any(String) },
                { line: 6, reason: 'MISSING_FIELDS', raw: expect.any(String) }
            ]);
            expect(await countFixtureRows()).toBe(3);
        });

        it('derives isActive and deletedAt from the currency field', async () => {
            const current = await readByCode(currentCode);
            expect(current.isActive).toBe(true);
            expect(current.deletedAt).toBeNull();

            const withdrawn = await readByCode(withdrawnCode);
            expect(withdrawn.isActive).toBe(false);
            expect(withdrawn.deletedAt).not.toBeNull();
        });

        it('stores the name as quoted data and marks the row as imported', async () => {
            const renamed = await readByCode(renamedCode);

            // Never toTitleCase, and the accents survive the round trip
            expect(renamed.name).toBe('Déficit de 11-beta-hidroxilasa');
            // termGroup defaults to LLT when the body does not carry it
            expect(renamed.termGroup).toBe('LLT');
            // The opposite of what 006 writes: the official dictionary is nobody's review queue
            expect(renamed.metadata).toMatchObject({
                importedFrom: 'MEDDRA',
                reviewStatus: 'APPROVED',
                autoCreated: false,
                dictionaryVersion: '28.0'
            });
        });

        it('creates a separate row when the same code already exists as LOCAL', async () => {
            // Uniqueness is by the pair, and MEDDRA/10099001 and LOCAL/10099001 are two terms
            const local = await DiagnosticTerm.create({ source: 'LOCAL', code: currentCode, name: 'Termino local homonimo' });

            expect(await DiagnosticTerm.count({ where: { code: currentCode } })).toBe(2);
            expect(local.getDataValue('source')).toBe('LOCAL');
            // The row is left in place: TRG_diagnosticTerm_preventPhysicalDelete blocks a DELETE,
            // and the MEDDRA side of the pair is what the rest of the block reads
        });

        // The criterion that really discriminates: a differential update that is not differential
        // would pass every other test in this block
        it('reimporting the same file writes nothing at all', async () => {
            const before = await Promise.all([currentCode, renamedCode, withdrawnCode].map(readByCode));

            const response = await importFile().field('dictionaryVersion', '28.0').attach('file', fixturePath);

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ read: 6, inserted: 0, updated: 0, unchanged: 3 });

            const after = await Promise.all([currentCode, renamedCode, withdrawnCode].map(readByCode));
            // No appDetails entry, no sysDetails.version bump and no updatedAt moved
            expect(after).toEqual(before);
        });

        it('updates only the row whose name changed', async () => {
            const before = await readByCode(renamedCode);

            const response = await importFile()
                .attach('file', buildFile('N', 'Déficit de 11-beta-hidroxilasa (revisado)'), 'llt.asc');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ read: 3, inserted: 0, updated: 1, unchanged: 2 });

            const after = await readByCode(renamedCode);
            expect(after.name).toBe('Déficit de 11-beta-hidroxilasa (revisado)');
            expect(after.appDetails).toBe(before.appDetails + 1);
            expect(after.version).toBe(( before.version ?? 0 ) + 1);
            // The update branch never rewrites metadata
            expect(after.metadata).toEqual(before.metadata);
        });

        it('flips the currency of a single row and touches no other deletedAt', async () => {
            const untouchedBefore = await readByCode(currentCode);

            // Same file, except the withdrawn term is declared current again
            const response = await importFile()
                .attach('file', buildFile('Y', 'Déficit de 11-beta-hidroxilasa (revisado)'), 'llt.asc');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });

            const reactivated = await readByCode(withdrawnCode);
            // Over source MEDDRA the file is the authority, so a reimport reactivates
            expect(reactivated.isActive).toBe(true);
            expect(reactivated.deletedAt).toBeNull();

            expect(await readByCode(currentCode)).toEqual(untouchedBefore);
        });

        it('keeps the metadata of a term born out of ESAVI-DIAGTERM-006', async () => {
            const code = `10099${ suffix.slice(-3) }`;
            await DiagnosticTerm.create({
                source: 'MEDDRA',
                code,
                name: 'Nombre anterior',
                metadata: { autoCreated: true, createdFrom: 'ESAVI-NOTEVENT-001', reviewStatus: 'PENDING' }
            });

            const response = await importFile()
                .attach('file', Buffer.from(`${ code }$Nombre del diccionario$1$$$$$$$Y$$`, 'utf8'), 'llt.asc');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ inserted: 0, updated: 1 });

            const row = await readByCode(code);
            expect(row.name).toBe('Nombre del diccionario');
            // Reconciling the two origins is the governance spec, and it needs these keys alive
            expect(row.metadata).toMatchObject({
                autoCreated: true,
                createdFrom: 'ESAVI-NOTEVENT-001',
                reviewStatus: 'PENDING'
            });
        });
    });
});
