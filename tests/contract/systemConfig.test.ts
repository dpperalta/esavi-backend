import request from 'supertest';
import { app } from '../../src/app';
import { SystemConfig, SystemConfigHistory } from '../../src/models';
import { SYSTEM_CONFIG_DEFAULTS } from '../../src/data/systemConfig.defaults';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * Contract suite for SPEC F26 — the seven canonical operations of systemConfig plus its three
 * non-canonical ones.
 *
 * Four things here go beyond the usual walkthrough, and all four are named as risks in §7.
 *
 * The uniqueness is COMPOSITE over (code, scope) and does not filter by isActive, so the same code
 * under another scope is a 201 while a repeated pair is a 409 even when the first row is deactivated.
 *
 * The value of an encrypted row is stored ciphered and compared DECRYPTED, so a PUT resending the
 * plain value the GET returned must leave the column identical byte for byte. Comparing ciphertext
 * would pass today — the IV of esaviCrypt is fixed — and would silently start writing on every PUT
 * the day it turns random.
 *
 * The history write is conditional on 'value' appearing in the output of buildDifferentialUpdate,
 * never on the key travelling in the body. That is the variant of the differential error the five
 * canonical criteria do NOT catch, because they look at appDetails and sysDetails and not at the
 * child table.
 *
 * And the 008 is only-insert: it must not repose a hand-tuned value nor reactivate a row somebody
 * deactivated on purpose.
 *
 * The rows of this file are never cleaned up: both tables sit inside the preventPhysicalDelete loop
 * of esaviapp.sql:1361-1375, so a destroy is blocked even with force. They are isolated by a suffix
 * in code and name — which is what `search` filters on — exactly as diluentCatalog.test.ts does.
 */
describe('systemConfig contract', () => {

    const base = '/api/system-configs';

    const suffix = Date.now().toString(36).toUpperCase();
    let sequence = 0;
    const aCode = ( prefix: string ) => `${ prefix }-${ suffix }-${ ++sequence }`;

    // What toConstantCase stores for a code the test wrote with hyphens. Searching by the raw one
    // would find nothing, which is the point: the column holds the normalized form
    const stored = ( code: string ) => code.replace(/-/g, '_').toUpperCase();

    // errorHandler logs every error it handles, and half of these tests trigger errors on purpose,
    // so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const createConfig = ( payload: Record<string, unknown> ) =>
        request(app).post(base).set(authHeader('SUPERADMIN')).send(payload);

    const readRow = async ( id: string ) => {
        const row = await SystemConfig.findByPk(id);
        return {
            code: row!.getDataValue('code'),
            name: row!.getDataValue('name'),
            description: row!.getDataValue('description'),
            value: row!.getDataValue('value'),
            valueType: row!.getDataValue('valueType'),
            scope: row!.getDataValue('scope'),
            isEncrypted: row!.getDataValue('isEncrypted'),
            isEditable: row!.getDataValue('isEditable'),
            isActive: row!.getDataValue('isActive'),
            deletedAt: row!.getDataValue('deletedAt'),
            updatedAt: row!.getDataValue('updatedAt'),
            appDetails: row!.getDataValue('appDetails') as { method: string, user: string }[],
            version: ( row!.getDataValue('sysDetails') as { version?: number } ).version
        };
    };

    const readHistory = async ( id: string ) => {
        const rows = await SystemConfigHistory.findAll({
            where: { systemConfigId: id },
            order: [['createdAt', 'ASC']]
        });
        return rows.map(row => ({
            previousValue: row.getDataValue('previousValue'),
            newValue: row.getDataValue('newValue'),
            changeReason: row.getDataValue('changeReason'),
            changedByUserId: row.getDataValue('changedByUserId')
        }));
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

        let systemConfigId: string;
        let code: string;

        // ESAVI-SYSCONF-001
        it('create responds 201 with the envelope, the code constant-cased and the name literal', async () => {
            code = aCode('ESAVI MAX UPLOAD');
            const response = await createConfig({
                code: `  ${ code }  `,
                name: '  Tamaño máximo de carga  ',
                description: '  Tope en megabytes  ',
                value: { mb: 20 }
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(typeof response.body.message).toBe('string');
            expect(response.body.data).toBeDefined();

            systemConfigId = response.body.data.systemConfigId;
            code = code.replace(/[ -]/g, '_').toUpperCase();

            expect(response.body.data.code).toBe(code);
            // Only trimmed: toTitleCase would turn this into 'Tamaño Máximo De Carga'
            expect(response.body.data.name).toBe('Tamaño máximo de carga');
            expect(response.body.data.description).toBe('Tope en megabytes');
            // The two DDL defaults the service resolves before checking uniqueness
            expect(response.body.data.scope).toBe('GLOBAL');
            expect(response.body.data.valueType).toBe('json');
            expect(response.body.data.isEncrypted).toBe(false);
            expect(response.body.data.isEditable).toBe(true);
            expect(response.body.data.isActive).toBe(true);
            // sysDetails is trigger state and never leaves the API
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        it('the create left exactly one history row, with previousValue null', async () => {
            const history = await readHistory(systemConfigId);
            expect(history).toHaveLength(1);
            expect(history[0].previousValue).toBeNull();
            expect(history[0].newValue).toEqual({ mb: 20 });
            expect(history[0].changedByUserId).not.toBeNull();
        });

        // ESAVI-SYSCONF-003
        it('getById responds 200 with the full row', async () => {
            const response = await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.systemConfigId).toBe(systemConfigId);
            expect(response.body.data.value).toEqual({ mb: 20 });
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        // ESAVI-SYSCONF-006
        it('getByCode resolves the same row whatever the case of the URL, defaulting to GLOBAL', async () => {
            const upper = await request(app).get(`${ base }/code/${ code }`).set(authHeader('USER'));
            const lower = await request(app).get(`${ base }/code/${ code.toLowerCase() }`).set(authHeader('USER'));

            expect(upper.status).toBe(200);
            expect(lower.status).toBe(200);
            expect(upper.body.data.systemConfigId).toBe(systemConfigId);
            expect(lower.body.data.systemConfigId).toBe(systemConfigId);
            expect(upper.body.data.scope).toBe('GLOBAL');
            // Same answer, another door: the shape is identical to the 003
            const byId = await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('USER'));
            expect(Object.keys(upper.body.data).sort()).toEqual(Object.keys(byId.body.data).sort());
        });

        // ESAVI-SYSCONF-002A
        it('the public listing returns { count, rows } ordered by scope and code', async () => {
            const response = await request(app).get(`${ base }?search=${ suffix }`).set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(typeof response.body.data.count).toBe('number');
            expect(Array.isArray(response.body.data.rows)).toBe(true);

            const pairs = response.body.data.rows.map(( row: { scope: string, code: string } ) => `${ row.scope }|${ row.code }`);
            expect(pairs).toEqual([...pairs].sort());
        });

        // ESAVI-SYSCONF-002B
        it('the admin listing accepts an ADMIN and rejects a USER', async () => {
            const admin = await request(app).get(`${ base }/admin?search=${ suffix }`).set(authHeader('ADMIN'));
            const user = await request(app).get(`${ base }/admin`).set(authHeader('USER'));

            expect(admin.status).toBe(200);
            expect(user.status).toBe(403);
        });

        // ESAVI-SYSCONF-004
        it('update responds 200 and writes only what changed', async () => {
            const before = await readRow(systemConfigId);
            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ name: 'Tamaño máximo de carga v2' });

            expect(response.status).toBe(200);
            expect(response.body.data.name).toBe('Tamaño máximo de carga v2');

            const after = await readRow(systemConfigId);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.appDetails[after.appDetails.length - 1].method).toBe('ESAVI-SYSCONF-004');
            expect(after.version).toBe(before.version! + 1);
        });

        // ESAVI-SYSCONF-007
        it('the history hangs off the parent and is SUPERADMIN only', async () => {
            const response = await request(app).get(`${ base }/${ systemConfigId }/history`).set(authHeader('SUPERADMIN'));
            const admin = await request(app).get(`${ base }/${ systemConfigId }/history`).set(authHeader('ADMIN'));

            expect(response.status).toBe(200);
            expect(admin.status).toBe(403);
            expect(response.body.data.rows[0].changedByUser).not.toBeNull();
            // Decrypted, and never repeated outside the nested object
            expect(response.body.data.rows[0].changedByUser.displayName).toBe('Test SUPERADMIN');
            expect(response.body.data.rows[0].changedByUserId).toBeUndefined();
        });

        // ESAVI-SYSCONF-005A
        it('delete deactivates, answers without data and hides the row from the public listing', async () => {
            const response = await request(app).delete(`${ base }/${ systemConfigId }`).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(response.body.data).toBeUndefined();

            const row = await readRow(systemConfigId);
            expect(row.isActive).toBe(false);
            expect(row.deletedAt).not.toBeNull();
            expect(row.appDetails[row.appDetails.length - 1].method).toBe('ESAVI-SYSCONF-005A');

            const asUser = await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('USER'));
            expect(asUser.status).toBe(404);
        });

        // ESAVI-SYSCONF-005B
        it('activate reverses it and clears deletedAt', async () => {
            const response = await request(app).patch(`${ base }/activate/${ systemConfigId }`).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();

            const row = await readRow(systemConfigId);
            expect(row.isActive).toBe(true);
            expect(row.deletedAt).toBeNull();
            expect(row.appDetails[row.appDetails.length - 1].method).toBe('ESAVI-SYSCONF-005B');
        });

        it('neither activation wrote a history row', async () => {
            const history = await readHistory(systemConfigId);
            expect(history).toHaveLength(1);
        });
    });

    describe('composite uniqueness of (code, scope)', () => {

        it('the repeated pair is a 409, and the same code under another scope is a 201', async () => {
            const code = aCode('DUP');
            expect((await createConfig({ code, name: 'Primera', value: {} })).status).toBe(201);

            const repeated = await createConfig({ code, name: 'Segunda', value: {} });
            expect(repeated.status).toBe(409);
            expect(repeated.body.ok).toBe(false);

            const scoped = await createConfig({ code, name: 'Otro ámbito', value: {}, scope: 'notification' });
            expect(scoped.status).toBe(201);
            expect(scoped.body.data.scope).toBe('NOTIFICATION');
        });

        it('a pair held by a DEACTIVATED row is still taken: 409 and never a 500', async () => {
            const code = aCode('DUP-INACTIVE');
            const first = await createConfig({ code, name: 'Primera', value: {} });
            expect(first.status).toBe(201);

            await request(app).delete(`${ base }/${ first.body.data.systemConfigId }`).set(authHeader('SUPERADMIN'));

            const repeated = await createConfig({ code, name: 'Segunda', value: {} });
            expect(repeated.status).toBe(409);
        });
    });

    describe('cross validation of value against valueType', () => {

        it('rejects a value that does not match the declared type on create', async () => {
            expect((await createConfig({ code: aCode('VT'), name: 'n', value: '42', valueType: 'number' })).status).toBe(400);
            expect((await createConfig({ code: aCode('VT'), name: 'n', value: 42, valueType: 'number' })).status).toBe(201);
        });

        it('accepts null only under valueType json', async () => {
            const asJson = await createConfig({ code: aCode('VT-NULL'), name: 'n', value: null, valueType: 'json' });
            expect(asJson.status).toBe(201);
            expect(asJson.body.data.value).toBeNull();
            // The JSON null landed in the column: jsonb NOT NULL forbids SQL NULL, not this
            expect((await readRow(asJson.body.data.systemConfigId)).value).toBeNull();

            expect((await createConfig({ code: aCode('VT-NULL'), name: 'n', value: null, valueType: 'number' })).status).toBe(400);
        });

        it('validates against the RESULTING valueType on update, not the one in the body', async () => {
            const created = await createConfig({ code: aCode('VT-UPD'), name: 'n', value: [1, 2], valueType: 'array' });
            const id = created.body.data.systemConfigId;

            // Only valueType travels: the stored value is an array, so 'number' leaves the row lying
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ valueType: 'number' })).status).toBe(400);

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: 7, valueType: 'number', changeReason: 'pasa a escalar' })).status).toBe(200);
        });
    });

    describe('listing filters', () => {

        it('filters by scope against the constant-cased value', async () => {
            const code = aCode('FILTER-SCOPE');
            await createConfig({ code, name: `Filtrada ${ suffix }`, value: {}, scope: 'notification' });

            const response = await request(app).get(`${ base }?scope=notification&search=${ stored(code) }`).set(authHeader('USER'));
            expect(response.status).toBe(200);
            expect(response.body.data.rows).toHaveLength(1);
            expect(response.body.data.rows[0].scope).toBe('NOTIFICATION');
        });

        it('rejects a valueType outside the five literals of the CHECK', async () => {
            expect((await request(app).get(`${ base }?valueType=texto`).set(authHeader('USER'))).status).toBe(400);
            expect((await request(app).get(`${ base }?valueType=number`).set(authHeader('USER'))).status).toBe(200);
        });

        it('search matches name AND code, and needs at least two characters', async () => {
            const code = aCode('SEARCHABLE');
            const name = `Nombre buscable ${ suffix }`;
            await createConfig({ code, name, value: {} });

            const byCode = await request(app).get(`${ base }?search=${ stored(code) }`).set(authHeader('USER'));
            const byName = await request(app).get(`${ base }?search=${ encodeURIComponent(name) }`).set(authHeader('USER'));

            expect(byCode.body.data.rows).toHaveLength(1);
            expect(byName.body.data.rows).toHaveLength(1);
            expect(byName.body.data.rows[0].code).toBe(stored(code));

            expect((await request(app).get(`${ base }?search=u`).set(authHeader('USER'))).status).toBe(400);
        });

        it('the public listing hides inactive rows and the admin one shows them', async () => {
            const created = await createConfig({ code: aCode('HIDDEN'), name: `Oculta ${ suffix }`, value: {} });
            const id = created.body.data.systemConfigId;
            await request(app).delete(`${ base }/${ id }`).set(authHeader('SUPERADMIN'));

            const publicList = await request(app).get(`${ base }?search=${ suffix }&limit=100`).set(authHeader('ADMIN'));
            const adminList = await request(app).get(`${ base }/admin?search=${ suffix }&limit=100`).set(authHeader('ADMIN'));

            const ids = ( rows: { systemConfigId: string }[] ) => rows.map(row => row.systemConfigId);
            expect(ids(publicList.body.data.rows)).not.toContain(id);
            expect(ids(adminList.body.data.rows)).toContain(id);
        });

        // SPEC F52 — name and code become the canonical parameters; search keeps covering both,
        // unchanged, since it already did before this spec
        describe('canonical name/code parameters — SPEC F52', () => {

            it('name and code filter separately', async () => {
                const code = aCode('CANON');
                const name = `Canonico buscable ${ suffix }`;
                await createConfig({ code, name, value: {} });

                const byName = await request(app).get(`${ base }?name=${ encodeURIComponent(name) }`).set(authHeader('USER'));
                const byCode = await request(app).get(`${ base }?code=${ stored(code) }`).set(authHeader('USER'));

                expect(byName.body.data.rows).toHaveLength(1);
                expect(byName.body.data.rows[0].code).toBe(stored(code));
                expect(byCode.body.data.rows).toHaveLength(1);
                expect(byCode.body.data.rows[0].code).toBe(stored(code));
            });

            it('?search= returns exactly what it did before this spec', async () => {
                const code = aCode('LEGACY');
                const name = `Legado buscable ${ suffix }`;
                await createConfig({ code, name, value: {} });

                const byCode = await request(app).get(`${ base }?search=${ stored(code) }`).set(authHeader('USER'));
                const byName = await request(app).get(`${ base }?search=${ encodeURIComponent(name) }`).set(authHeader('USER'));

                expect(byCode.body.data.rows).toHaveLength(1);
                expect(byName.body.data.rows).toHaveLength(1);
                expect(byName.body.data.rows[0].code).toBe(stored(code));
            });

            it('explicit name wins over search when both arrive', async () => {
                const code = aCode('WINS');
                const name = `Prioridad canonica ${ suffix }`;
                await createConfig({ code, name, value: {} });

                const response = await request(app)
                    .get(`${ base }?name=${ encodeURIComponent(name) }&search=noExisteEsteTermino${ suffix }`)
                    .set(authHeader('USER'));

                expect(response.body.data.rows).toHaveLength(1);
                expect(response.body.data.rows[0].code).toBe(stored(code));
            });

            it('a literal underscore in code does not act as a single-character wildcard', async () => {
                const wild = await createConfig({ code: `WILD-A-${ suffix }`, name: `Wildcard probe ${ suffix }`, value: {} });
                const twin = await createConfig({ code: `WILDXA-${ suffix }`, name: `Wildcard probe twin ${ suffix }`, value: {} });

                const response = await request(app).get(`${ base }?code=WILD_A_${ suffix }`).set(authHeader('USER'));

                const ids = response.body.data.rows.map((row: { systemConfigId: string }) => row.systemConfigId);
                expect(ids).toContain(wild.body.data.systemConfigId);
                expect(ids).not.toContain(twin.body.data.systemConfigId);
            });

        });
    });

    describe('the asymmetry of canViewInactive', () => {

        it('an inactive row is 404 for USER and for ADMIN, and 200 for SUPERADMIN', async () => {
            const created = await createConfig({ code: aCode('INACTIVE'), name: `Inactiva ${ suffix }`, value: {} });
            const id = created.body.data.systemConfigId;
            await request(app).delete(`${ base }/${ id }`).set(authHeader('SUPERADMIN'));

            expect((await request(app).get(`${ base }/${ id }`).set(authHeader('USER'))).status).toBe(404);
            expect((await request(app).get(`${ base }/${ id }`).set(authHeader('ADMIN'))).status).toBe(404);
            expect((await request(app).get(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
        });
    });

    describe('route resolution', () => {

        it('the literal paths are not captured as an :id', async () => {
            expect((await request(app).get(`${ base }/admin`).set(authHeader('ADMIN'))).status).toBe(200);
            expect((await request(app).post(`${ base }/sync`).set(authHeader('SUPERADMIN'))).status).toBe(200);
            // The seeded default lives under scope PAGINATION, so without ?scope it would resolve
            // against GLOBAL and answer 404 — which is the composite uniqueness doing its job
            expect((await request(app).get(`${ base }/code/ESAVI_APP_DEFAULT_LIMIT?scope=PAGINATION`).set(authHeader('USER'))).status).toBe(200);
            expect((await request(app).get(`${ base }/code/ESAVI_APP_DEFAULT_LIMIT`).set(authHeader('USER'))).status).toBe(404);
        });

        it('a path parameter that is not a UUID is a 400', async () => {
            expect((await request(app).get(`${ base }/not-a-uuid`).set(authHeader('USER'))).status).toBe(400);
        });

        it('a non-existent id is a 404 in every operation that takes one', async () => {
            const ghost = '11111111-1111-4111-8111-111111111111';
            expect((await request(app).get(`${ base }/${ ghost }`).set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).put(`${ base }/${ ghost }`).set(authHeader('SUPERADMIN')).send({ name: 'x' })).status).toBe(404);
            expect((await request(app).delete(`${ base }/${ ghost }`).set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).patch(`${ base }/activate/${ ghost }`).set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).get(`${ base }/${ ghost }/history`).set(authHeader('SUPERADMIN'))).status).toBe(404);
            expect((await request(app).get(`${ base }/code/NO_EXISTE_${ suffix }`).set(authHeader('USER'))).status).toBe(404);
        });
    });

    describe('the four writes are SUPERADMIN', () => {

        it('an ADMIN is refused on create, update, delete and activate', async () => {
            const created = await createConfig({ code: aCode('ROLES'), name: `Roles ${ suffix }`, value: {} });
            const id = created.body.data.systemConfigId;

            expect((await request(app).post(base).set(authHeader('ADMIN')).send({ code: aCode('X'), name: 'x', value: {} })).status).toBe(403);
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('ADMIN')).send({ name: 'x' })).status).toBe(403);
            expect((await request(app).delete(`${ base }/${ id }`).set(authHeader('ADMIN'))).status).toBe(403);
            expect((await request(app).patch(`${ base }/activate/${ id }`).set(authHeader('ADMIN'))).status).toBe(403);
        });
    });

    describe('isEditable protects the value, not the existence', () => {

        it('a protected row refuses the PUT with 409 even when the body changes nothing', async () => {
            const created = await createConfig({ code: aCode('LOCKED'), name: `Bloqueada ${ suffix }`, value: {}, isEditable: false });
            const id = created.body.data.systemConfigId;

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN')).send({})).status).toBe(409);
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN')).send({ name: 'x' })).status).toBe(409);
        });

        it('the same protected row deactivates and reactivates with a 200', async () => {
            const created = await createConfig({ code: aCode('LOCKED-DEL'), name: `Bloqueada ${ suffix }`, value: {}, isEditable: false });
            const id = created.body.data.systemConfigId;

            expect((await request(app).delete(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
            expect((await request(app).patch(`${ base }/activate/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
        });

        it('isEditable is mutable and enters candidates compared against undefined', async () => {
            const created = await createConfig({ code: aCode('LOCKABLE'), name: `Protegible ${ suffix }`, value: {} });
            const id = created.body.data.systemConfigId;

            // A truthiness test would drop the false and make it impossible to protect a row again
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ isEditable: false })).status).toBe(200);
            expect((await readRow(id)).isEditable).toBe(false);
        });
    });

    describe('differential update', () => {

        let systemConfigId: string;

        beforeAll(async () => {
            const created = await createConfig({
                code: aCode('DIFF'),
                name: `Diferencial ${ suffix }`,
                description: 'Con descripción',
                value: { mb: 20 },
                scope: 'pagination'
            });
            systemConfigId = created.body.data.systemConfigId;
        });

        it('a PUT resending the GET response writes nothing', async () => {
            await expectPutOfGetResponseWritesNothing({
                path: base,
                id: systemConfigId,
                model: SystemConfig,
                role: 'SUPERADMIN'
            });
        });

        it('an empty body behaves the same', async () => {
            const before = await readRow(systemConfigId);
            const response = await request(app).put(`${ base }/${ systemConfigId }`).set(authHeader('SUPERADMIN')).send({});

            expect(response.status).toBe(200);
            const after = await readRow(systemConfigId);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(after.version).toBe(before.version);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('a PUT resending the immutable fields changed is a 200 that ignores them in silence', async () => {
            const before = await readRow(systemConfigId);
            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ code: 'OTRO_CODIGO', scope: 'OTRO_AMBITO', isEncrypted: true, isActive: false });

            expect(response.status).toBe(200);
            const after = await readRow(systemConfigId);
            expect(after.code).toBe(before.code);
            expect(after.scope).toBe(before.scope);
            expect(after.isEncrypted).toBe(false);
            expect(after.isActive).toBe(true);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('a PUT changing a single field adds one appDetails entry and bumps the version by one', async () => {
            const before = await readRow(systemConfigId);
            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ description: 'Descripción nueva' });

            expect(response.status).toBe(200);
            const after = await readRow(systemConfigId);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.version).toBe(before.version! + 1);
            expect(after.description).toBe('Descripción nueva');
        });

        it('null empties a nullable column and is a change, unlike an absent key', async () => {
            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ description: null });

            expect(response.status).toBe(200);
            expect((await readRow(systemConfigId)).description).toBeNull();
        });
    });

    describe('conditional history write', () => {

        it('a PUT that only changes name does NOT add a history row', async () => {
            const created = await createConfig({ code: aCode('HIST-NAME'), name: `Historial ${ suffix }`, value: { a: 1 } });
            const id = created.body.data.systemConfigId;
            expect(await readHistory(id)).toHaveLength(1);

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ name: 'Otro nombre' })).status).toBe(200);

            // The table is called previousValue/newValue: it records changes of value, not of metadata
            expect(await readHistory(id)).toHaveLength(1);
        });

        it('a PUT that changes value adds one row with the right previousValue and changeReason', async () => {
            const created = await createConfig({ code: aCode('HIST-VALUE'), name: `Historial ${ suffix }`, value: { a: 1 } });
            const id = created.body.data.systemConfigId;

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: { a: 2 }, changeReason: 'ajuste de capacidad' })).status).toBe(200);

            const history = await readHistory(id);
            expect(history).toHaveLength(2);
            expect(history[1].previousValue).toEqual({ a: 1 });
            expect(history[1].newValue).toEqual({ a: 2 });
            expect(history[1].changeReason).toBe('ajuste de capacidad');
        });

        it('a PUT resending the SAME value adds no row, whether or not a reason travels', async () => {
            const created = await createConfig({ code: aCode('HIST-SAME'), name: `Historial ${ suffix }`, value: { a: 1 } });
            const id = created.body.data.systemConfigId;

            // This is the trigger the five canonical criteria do not catch: the key travels in the
            // body but the value did not change, so the helper returns nothing for it
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: { a: 1 } })).status).toBe(200);
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: { a: 1 }, changeReason: 'sin cambio real' })).status).toBe(200);

            expect(await readHistory(id)).toHaveLength(1);
        });

        it('changeReason is required when the value really changes, and only then', async () => {
            const created = await createConfig({ code: aCode('HIST-REASON'), name: `Historial ${ suffix }`, value: { a: 1 } });
            const id = created.body.data.systemConfigId;

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: { a: 9 } })).status).toBe(400);
            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ name: 'Sin razón y sin valor' })).status).toBe(200);

            // The failed attempt wrote neither the row nor its history
            expect((await readRow(id)).value).toEqual({ a: 1 });
            expect(await readHistory(id)).toHaveLength(1);
        });

        it('the history is ordered createdAt DESC and a non-existent parent is a 404, not an empty list', async () => {
            const created = await createConfig({ code: aCode('HIST-ORDER'), name: `Historial ${ suffix }`, value: { a: 1 } });
            const id = created.body.data.systemConfigId;

            await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN')).send({ value: { a: 2 }, changeReason: 'dos' });
            await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN')).send({ value: { a: 3 }, changeReason: 'tres' });

            const response = await request(app).get(`${ base }/${ id }/history`).set(authHeader('SUPERADMIN'));
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows[0].changeReason).toBe('tres');

            const dates = response.body.data.rows.map(( row: { createdAt: string } ) => new Date(row.createdAt).getTime());
            expect(dates).toEqual([...dates].sort(( a, b ) => b - a));
        });
    });

    describe('encryption', () => {

        let systemConfigId: string;
        const secret = { token: 'shh-super-secreto' };

        beforeAll(async () => {
            const created = await createConfig({
                code: aCode('SECRET'),
                name: `Secreto ${ suffix }`,
                value: secret,
                isEncrypted: true,
                changeReason: 'alta inicial'
            });
            systemConfigId = created.body.data.systemConfigId;
        });

        it('the column holds an object with the single key enc, and not the plain text', async () => {
            const row = await readRow(systemConfigId);
            expect(Object.keys(row.value as object)).toEqual(['enc']);
            expect(JSON.stringify(row.value)).not.toContain('shh-super-secreto');
        });

        it('the create answers value null even to the SUPERADMIN that created it', async () => {
            const created = await createConfig({
                code: aCode('SECRET-CREATE'),
                name: `Secreto ${ suffix }`,
                value: { token: 'otro' },
                isEncrypted: true
            });
            expect(created.status).toBe(201);
            expect(created.body.data.value).toBeNull();
            expect(created.body.data.isEncrypted).toBe(true);
        });

        it('both listings mask it for every role, SUPERADMIN included', async () => {
            for( const role of ['USER', 'ADMIN', 'SUPERADMIN'] as const ) {
                const publicList = await request(app).get(`${ base }?search=${ suffix }&limit=100`).set(authHeader(role));
                const encrypted = publicList.body.data.rows.filter(( row: { isEncrypted: boolean } ) => row.isEncrypted);
                expect(encrypted.length).toBeGreaterThan(0);
                expect(encrypted.every(( row: { value: unknown } ) => row.value === null)).toBe(true);
            }

            const adminList = await request(app).get(`${ base }/admin?search=${ suffix }&limit=100`).set(authHeader('SUPERADMIN'));
            const encrypted = adminList.body.data.rows.filter(( row: { isEncrypted: boolean } ) => row.isEncrypted);
            expect(encrypted.every(( row: { value: unknown } ) => row.value === null)).toBe(true);
        });

        it('the 003 and the 006 decrypt only for SUPERADMIN', async () => {
            const code = ( await readRow(systemConfigId) ).code;

            for( const role of ['USER', 'ADMIN'] as const ) {
                expect((await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader(role))).body.data.value).toBeNull();
                expect((await request(app).get(`${ base }/code/${ code }`).set(authHeader(role))).body.data.value).toBeNull();
            }

            expect((await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('SUPERADMIN'))).body.data.value).toEqual(secret);
            expect((await request(app).get(`${ base }/code/${ code }`).set(authHeader('SUPERADMIN'))).body.data.value).toEqual(secret);
        });

        it('the masking is null and never a sentinel string', async () => {
            const response = await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('ADMIN'));
            expect(JSON.stringify(response.body)).not.toContain('***');
        });

        it('a PUT resending the DECRYPTED value writes nothing and leaves the column identical', async () => {
            const before = await readRow(systemConfigId);
            const read = await request(app).get(`${ base }/${ systemConfigId }`).set(authHeader('SUPERADMIN'));
            expect(read.body.data.value).toEqual(secret);

            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ value: read.body.data.value, changeReason: 'reenvío sin cambio' });

            expect(response.status).toBe(200);
            const after = await readRow(systemConfigId);
            // Byte for byte: the diff compared plain text, so nothing was re-encrypted and rewritten
            expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));
            expect(after.updatedAt).toEqual(before.updatedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(await readHistory(systemConfigId)).toHaveLength(1);
        });

        it('a real change re-encrypts, and the history keeps both values under the same regime', async () => {
            const before = await readRow(systemConfigId);
            const response = await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ value: { token: 'rotado' }, changeReason: 'rotación de credencial' });

            expect(response.status).toBe(200);
            expect(response.body.data.value).toEqual({ token: 'rotado' });

            const after = await readRow(systemConfigId);
            expect(Object.keys(after.value as object)).toEqual(['enc']);
            expect(JSON.stringify(after.value)).not.toContain('rotado');

            const history = await readHistory(systemConfigId);
            expect(history).toHaveLength(2);
            expect(JSON.stringify(history[1].previousValue)).toBe(JSON.stringify(before.value));
            expect(JSON.stringify(history[1].newValue)).toBe(JSON.stringify(after.value));
        });

        it('the 007 decrypts both values, because that endpoint is already SUPERADMIN only', async () => {
            const response = await request(app).get(`${ base }/${ systemConfigId }/history`).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
            expect(response.body.data.rows[0].previousValue).toEqual(secret);
            expect(response.body.data.rows[0].newValue).toEqual({ token: 'rotado' });
            expect(response.body.data.rows[1].previousValue).toBeNull();
            expect(response.body.data.rows[1].newValue).toEqual(secret);
        });

        it('a PUT with isEncrypted false does not decrypt the row: the field is immutable', async () => {
            const before = await readRow(systemConfigId);
            expect((await request(app).put(`${ base }/${ systemConfigId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ isEncrypted: false })).status).toBe(200);

            const after = await readRow(systemConfigId);
            expect(after.isEncrypted).toBe(true);
            expect(JSON.stringify(after.value)).toBe(JSON.stringify(before.value));
        });
    });

    describe('idempotent seeding', () => {

        const sync = ( role: 'SUPERADMIN' | 'ADMIN' = 'SUPERADMIN' ) =>
            request(app).post(`${ base }/sync`).set(authHeader(role));

        const findSeeded = ( code: string, scope: string ) =>
            SystemConfig.findOne({ where: { code, scope } });

        it('seeds what is missing and skips what already exists', async () => {
            // The suites of a run share the database, so the first call may already find rows seeded
            // by an earlier one. What is invariant is that after it, everything exists and a second
            // call creates nothing
            const first = await sync();
            expect(first.status).toBe(200);
            expect(first.body.data.created.length + first.body.data.skipped.length).toBe(SYSTEM_CONFIG_DEFAULTS.length);
            expect(Object.keys(first.body.data.created[0] ?? first.body.data.skipped[0]).sort()).toEqual(['code', 'scope']);

            const second = await sync();
            expect(second.body.data.created).toHaveLength(0);
            expect(second.body.data.skipped).toHaveLength(SYSTEM_CONFIG_DEFAULTS.length);
        });

        it('every seeded row exists with its declared valueType and left its history row', async () => {
            for( const entry of SYSTEM_CONFIG_DEFAULTS ) {
                const row = await findSeeded(entry.code, entry.scope);
                expect(row).not.toBeNull();
                expect(row!.getDataValue('valueType')).toBe(entry.valueType);

                const history = await readHistory(row!.getDataValue('systemConfigId'));
                expect(history.length).toBeGreaterThanOrEqual(1);
                expect(history[0].previousValue).toBeNull();
            }
        });

        it('a deactivated seeded row counts as skipped and is NOT reactivated', async () => {
            const entry = SYSTEM_CONFIG_DEFAULTS[SYSTEM_CONFIG_DEFAULTS.length - 1];
            const row = await findSeeded(entry.code, entry.scope);
            const id = row!.getDataValue('systemConfigId');

            await request(app).delete(`${ base }/${ id }`).set(authHeader('SUPERADMIN'));
            expect((await readRow(id)).isActive).toBe(false);

            const response = await sync();
            expect(response.body.data.created).toHaveLength(0);
            expect(response.body.data.skipped.some(( x: { code: string } ) => x.code === entry.code)).toBe(true);
            // Somebody deactivated it on purpose, and a sync cannot undo that decision
            expect((await readRow(id)).isActive).toBe(false);

            await request(app).patch(`${ base }/activate/${ id }`).set(authHeader('SUPERADMIN'));
        });

        it('a hand-tuned value survives a new sync', async () => {
            const entry = SYSTEM_CONFIG_DEFAULTS[0];
            const row = await findSeeded(entry.code, entry.scope);
            const id = row!.getDataValue('systemConfigId');

            expect((await request(app).put(`${ base }/${ id }`).set(authHeader('SUPERADMIN'))
                .send({ value: 77, changeReason: 'ajuste manual en producción' })).status).toBe(200);

            await sync();
            expect((await readRow(id)).value).toBe(77);
        });

        it('an entry with an incompatible valueType aborts the whole seeding with 400 and creates nothing', async () => {
            const good = { code: `SYNC_GOOD_${ suffix }`, name: 'Buena', value: 1, valueType: 'number' as const, scope: 'PRUEBA' };
            const broken = { code: `SYNC_BROKEN_${ suffix }`, name: 'Rota', value: 'x', valueType: 'number' as const, scope: 'PRUEBA' };
            SYSTEM_CONFIG_DEFAULTS.push(good, broken);

            try {
                expect((await sync()).status).toBe(400);
                // The good one came BEFORE the broken one in the walk and still was not created
                expect(await findSeeded(good.code, good.scope)).toBeNull();
                expect(await findSeeded(broken.code, broken.scope)).toBeNull();
            } finally {
                SYSTEM_CONFIG_DEFAULTS.splice(SYSTEM_CONFIG_DEFAULTS.length - 2, 2);
            }
        });

        it('an ADMIN is refused', async () => {
            expect((await sync('ADMIN')).status).toBe(403);
        });
    });
});
