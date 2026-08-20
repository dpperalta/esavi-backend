import fs from 'fs';
import path from 'path';
import request from 'supertest';
import {
    CatalogItem,
    CatalogType,
    DiagnosticTerm,
    EsaviCase,
    HealthFacility,
    NotificationPregnancy,
    NotificationPregnancyComplication,
    Patient,
    SystemConfig
} from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import es from '../../src/data/i18n/es.json';
import en from '../../src/data/i18n/en.json';
import nl from '../../src/data/i18n/nl.json';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the eight notificationPregnancyComplication operations of SPEC F27. It walks
 * the entity end to end — create, list active, list all, read by id, update, deactivate,
 * reactivate, purge — and covers what cannot be checked by hand reliably.
 *
 * This is the eighth and last satellite of notification, and four axes are proper to it.
 *
 * The two hop inherited visibility with a one to one first hop. notificationDiluent introduced
 * the chain, but both of its hops are N. Here UQ_notificationPregnancy_notification allows a
 * single pregnancy per notification, so the fan out only opens at the second level.
 *
 * The sortOrder finding of F16, which applies here and NOT in the parent. F25 could declare the
 * 005B of notificationPregnancy a clean delegation because that table has no sortOrder. This one
 * is in setSortOrderByParent and has the partial unique index, so reactivating a row whose number
 * another live sister already took must move it first. Copying the parent's 005B by proximity is
 * the most probable mistake of the spec, and the collision scenario below fails loudly if anyone
 * does.
 *
 * The resolution against the clinical master with ONE text column instead of three. There is
 * nowhere to denormalize the master's name or code, so complicationRawName holds the notifier's
 * text only when it differs, and the canonical name is read from the include. That makes the
 * incomingName formula shorter than F16's — and its second condition just as necessary.
 *
 * The duplicate guard no constraint backs. The pair (diagnosticTermId, complicationTypeItemId)
 * may not repeat among the ACTIVE complications of a pregnancy, which is deliberately the
 * opposite of the 001 of F25: there a real UNIQUE was going to reject the insert anyway. Here the
 * rule is the service's invention, so it does not reach beyond what the database imposes — and a
 * 005B can resurrect a duplicate, which is an assumed consequence mounted below on purpose.
 */
describe('notificationPregnancyComplication contract', () => {

    const basePath = '/api/notification-pregnancy-complications';
    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const logFile = path.join(__dirname, '..', '..', 'src', 'logs', 'esaviLog.log');

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    // The data precondition the spec declares: the pregnancyComplicationType catalog is populated
    // by hand, so the suite seeds the items it needs
    let femaleItemId: string;
    let typeItemId: string;
    let otherTypeItemId: string;
    let inactiveTypeItemId: string;

    beforeAll(async () => {
        await seedTestUsers();
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        const sexType = await CatalogType.create({ code: `sex${ suffix }`, name: `Sex ${ suffix }` });
        femaleItemId = ( await CatalogItem.create({
            catalogTypeId: sexType.getDataValue('catalogTypeId'), code: `F${ suffix }`, name: 'Femenino', value: '2'
        }) ).getDataValue('catalogItemId');
        // systemConfigHistory hangs from the row with ON DELETE RESTRICT, so a row another suite
        // left behind is retired by renaming its code instead of being destroyed — the same way the
        // suite of F25 does it. The service reads by (code, scope), so a renamed row is an absent
        // one as far as the rule is concerned
        await SystemConfig.update(
            { code: `RETIRED_PREGCOMP_${ suffix }` },
            { where: { code: 'PREGNANCY_FEMALE_SEX_ITEM' } }
        );
        await SystemConfig.create({
            code: 'PREGNANCY_FEMALE_SEX_ITEM', name: 'Pregnancy female sex item',
            value: femaleItemId, valueType: 'string', scope: 'GLOBAL', isEncrypted: false
        });

        // The catalog code is the one the service anchors to. It is created once and reused: other
        // suites may have seeded it already
        const complicationType = await CatalogType.findOne({ where: { code: 'pregnancyComplicationType' } })
            ?? await CatalogType.create({ code: 'pregnancyComplicationType', name: 'Pregnancy Complication Type' });
        const catalogTypeId = complicationType.getDataValue('catalogTypeId');
        typeItemId = ( await CatalogItem.create({
            catalogTypeId, code: `CONG${ suffix }`, name: 'Anomalias congenitas', value: '1'
        }) ).getDataValue('catalogItemId');
        otherTypeItemId = ( await CatalogItem.create({
            catalogTypeId, code: `FETAL${ suffix }`, name: 'Complicaciones fetales', value: '2'
        }) ).getDataValue('catalogItemId');
        inactiveTypeItemId = ( await CatalogItem.create({
            catalogTypeId, code: `OFF${ suffix }`, name: 'Retirada', value: '3', isActive: false
        }) ).getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    const notifyNewPregnancy = async (): Promise<{ pregnancyId: string, notificationId: string }> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Complication ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`PC${ counter }${ suffix }`),
            healthSystemCode: `PC${ counter }${ suffix }`,
            birthDate: '2000-05-04',
            sexItemId: femaleItemId
        });
        const facility = await HealthFacility.create({
            localCode: `PC${ counter }${ suffix }`,
            name: `Complication ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `PC-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2026-12-31'
        });
        const notification = await request(app).post('/api/notifications').set(authHeader('USER')).send({
            caseId: esaviCase.getDataValue('caseId'),
            notificationType: 'NON_SEVERE',
            esaviDescription: 'Fever after the dose'
        });
        const notificationId = notification.body.data.notificationId;
        const pregnancy = await request(app).post('/api/notification-pregnancies').set(authHeader('USER')).send({
            notificationId,
            wasPregnantAtVaccination: 'YES'
        });
        return { pregnancyId: pregnancy.body.data.pregnancyId, notificationId };
    };

    const createComplication = ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    const getComplication = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));

    const listActive = ( pregnancyId: string, role: TestRole = 'USER', qs: string = '' ) =>
        request(app).get(`${ basePath }/pregnancy/${ pregnancyId }${ qs }`).set(authHeader(role));

    const listAll = ( pregnancyId: string, role: TestRole = 'ADMIN', qs: string = '' ) =>
        request(app).get(`${ basePath }/admin/pregnancy/${ pregnancyId }${ qs }`).set(authHeader(role));

    const updateComplication = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const deleteComplication = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`${ basePath }/${ id }`).set(authHeader(role));

    const activateComplication = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`${ basePath }/activate/${ id }`).set(authHeader(role));

    const purgeComplication = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    const deactivatePregnancy = ( id: string ) =>
        request(app).delete(`/api/notification-pregnancies/${ id }`).set(authHeader('ADMIN'));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new complication over its own pregnancy, ready to be read or updated
    const newComplication = async (
        payload: Record<string, unknown> = {}
    ): Promise<{ complicationId: string, pregnancyId: string, notificationId: string }> => {
        const { pregnancyId, notificationId } = await notifyNewPregnancy();
        const created = await createComplication({
            pregnancyId,
            complicationTypeItemId: typeItemId,
            complicationName: 'Anomalia cardiaca',
            ...payload
        });
        return { complicationId: created.body.data.complicationId, pregnancyId, notificationId };
    };

    const rowOf = async ( id: string ) => await NotificationPregnancyComplication.findByPk(id);

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await rowOf(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const rowVersion = async ( id: string ): Promise<number | undefined> => {
        const row = await rowOf(id);
        return ( row?.getDataValue('sysDetails') as { version?: number } | null )?.version;
    };

    describe('ESAVI-PREGCOMP-001 — create', () => {

        it('creates a free text complication and lets the trigger number it', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const response = await createComplication({
                pregnancyId,
                complicationTypeItemId: typeItemId,
                complicationName: '  Anomalia cardiaca  ',
                notes: '  Detectada en ecografia  '
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.diagnosticTermId).toBeNull();
            expect(response.body.data.diagnosticTerm).toBeNull();
            // Only trimmed, never title cased: the column reproduces what the notifier wrote
            expect(response.body.data.complicationRawName).toBe('Anomalia cardiaca');
            expect(response.body.data.notes).toBe('Detectada en ecografia');
            expect(response.body.data.complicationType.catalogItemId).toBe(typeItemId);
            expect(response.body.data.sortOrder).toBe(1);
            expect(await auditMethods(response.body.data.complicationId)).toEqual(['ESAVI-PREGCOMP-001']);
        });

        it('numbers three sibling complications 1, 2 and 3 without the service sending it', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const sortOrders: number[] = [];
            for( const complicationName of ['Primera', 'Segunda', 'Tercera'] ) {
                const created = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName });
                sortOrders.push(created.body.data.sortOrder);
            }

            expect(sortOrders).toEqual([1, 2, 3]);
        });

        it('ignores a sortOrder arriving in the body instead of answering 400', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Con orden', sortOrder: 5
            });

            expect(response.status).toBe(201);
            expect(response.body.data.sortOrder).toBe(1);
        });

        it('leaves the jsonb column of the table at its default and out of the response', async () => {
            const { complicationId } = await newComplication();

            const row = await rowOf(complicationId);
            expect(row?.getDataValue('metadata')).toEqual({});
            const response = await getComplication(complicationId);
            expect(response.body.data.metadata).toBeUndefined();
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        it('answers 400 without complicationName and without complicationTypeItemId', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            expect(( await createComplication({ pregnancyId, complicationTypeItemId: typeItemId }) ).status).toBe(400);
            expect(( await createComplication({ pregnancyId, complicationName: 'Sin tipo' }) ).status).toBe(400);
        });

        it('answers 400 for a complicationName over 500 characters, not a Postgres error', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'x'.repeat(501)
            });

            expect(response.status).toBe(400);
        });

        it('answers 400 for a misspelled source', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Algo',
                complicationCode: 'ABC', source: 'MEDRA'
            });

            expect(response.status).toBe(400);
        });

        it('answers 404 over an inactive pregnancy and over an inactive notification, with one code', async () => {
            const first = await notifyNewPregnancy();
            await deactivatePregnancy(first.pregnancyId);
            const overPregnancy = await createComplication({
                pregnancyId: first.pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'X'
            });
            expect(overPregnancy.status).toBe(404);
            expect(overPregnancy.body.code).toBe('PREGCOMP_001_PREGNANCY_NOT_FOUND');

            const second = await notifyNewPregnancy();
            await deactivateNotification(second.notificationId);
            const overNotification = await createComplication({
                pregnancyId: second.pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'X'
            });
            expect(overNotification.status).toBe(404);
            expect(overNotification.body.code).toBe('PREGCOMP_001_PREGNANCY_NOT_FOUND');
        });

        it('answers 404 for a type of another catalog, an inactive one and an unknown one', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            for( const complicationTypeItemId of [femaleItemId, inactiveTypeItemId, unknownUuid] ) {
                const response = await createComplication({ pregnancyId, complicationTypeItemId, complicationName: 'X' });
                expect(response.status).toBe(404);
                expect(response.body.code).toBe('PREGCOMP_001_COMPLICATION_TYPE_NOT_FOUND');
            }
        });

        it('creating over a pregnancy that says hasComplications NO answers 201 and leaves the parent alone', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            await request(app).put(`/api/notification-pregnancies/${ pregnancyId }`)
                .set(authHeader('USER')).send({ hasComplications: 'NO' });

            const parentBefore = await NotificationPregnancy.findByPk(pregnancyId);
            const versionBefore = ( parentBefore!.getDataValue('sysDetails') as { version?: number } | null )?.version;
            const updatedAtBefore = parentBefore!.getDataValue('updatedAt');
            const appDetailsBefore = ( parentBefore!.getDataValue('appDetails') as unknown[] ).length;

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Incoherente pero valida'
            });
            expect(response.status).toBe(201);

            const parentAfter = await NotificationPregnancy.findByPk(pregnancyId);
            expect(parentAfter!.getDataValue('hasComplications')).toBe('NO');
            expect(( parentAfter!.getDataValue('sysDetails') as { version?: number } | null )?.version).toBe(versionBefore);
            expect(parentAfter!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
            expect(( parentAfter!.getDataValue('appDetails') as unknown[] ).length).toBe(appDetailsBefore);
        });

    });

    describe('the resolution against the clinical master', () => {

        it('coins the term on the LOCAL branch, normalized and marked', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'Anomalia cardiaca',
                complicationCode: `  anomalia cardiaca ${ suffix }  `
            });

            expect(response.status).toBe(201);
            const term = await DiagnosticTerm.findByPk(response.body.data.diagnosticTermId);
            expect(term?.getDataValue('source')).toBe('LOCAL');
            expect(term?.getDataValue('code')).toBe(`ANOMALIA_CARDIACA_${ suffix }`);
            expect(( term?.getDataValue('metadata') as { autoCreated?: boolean } ).autoCreated).toBe(true);
        });

        it('never creates on an external source, and answers 404', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const before = await DiagnosticTerm.count();

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Algo',
                complicationCode: `NOPE${ suffix }`, source: 'MEDDRA'
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PREGCOMP_001_DIAGTERM_NOT_FOUND');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

        it('keeps the divergence and clears the coincidence', async () => {
            const code = `DIVERG${ suffix }`;
            // The term is coined first, with the master's own name
            const seed = await notifyNewPregnancy();
            const coined = await createComplication({
                pregnancyId: seed.pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'Anomalia cardiaca', complicationCode: code
            });
            expect(coined.body.data.complicationRawName).toBeNull();

            const { pregnancyId } = await notifyNewPregnancy();
            const diverging = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'problema del corazon', complicationCode: code
            });

            expect(diverging.body.data.complicationRawName).toBe('problema del corazon');
            expect(diverging.body.data.diagnosticTermId).toBe(coined.body.data.diagnosticTermId);
            // The canonical name is read from the master, never denormalized here
            expect(diverging.body.data.diagnosticTerm.name).toBe('Anomalia cardiaca');
        });

        it('returns the term with six fields and without its jsonb column', async () => {
            const { complicationId } = await newComplication({ complicationCode: `SHAPE${ suffix }` });

            const response = await getComplication(complicationId);

            expect(Object.keys(response.body.data.diagnosticTerm).sort()).toEqual([
                'code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup'
            ]);
            expect(Object.keys(response.body.data.complicationType).sort()).toEqual([
                'catalogItemId', 'code', 'isActive', 'name'
            ]);
        });

    });

    describe('the duplicate guard', () => {

        it('answers 409 for the same term and the same type, 201 for either one different', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const code = `DUP${ suffix }`;
            const payload = { pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Dup', complicationCode: code };

            expect(( await createComplication(payload) ).status).toBe(201);

            const duplicate = await createComplication(payload);
            expect(duplicate.status).toBe(409);
            expect(duplicate.body.code).toBe('PREGCOMP_001_ALREADY_EXISTS');

            expect(( await createComplication({ ...payload, complicationTypeItemId: otherTypeItemId }) ).status).toBe(201);
            expect(( await createComplication({ ...payload, complicationCode: `${ code }B` }) ).status).toBe(201);
        });

        it('looks only at ACTIVE rows: deactivate and reload answers 201, not 409', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const payload = {
                pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'Recargable', complicationCode: `RELOAD${ suffix }`
            };
            const first = await createComplication(payload);
            await deleteComplication(first.body.data.complicationId);

            // Deliberately the opposite of the 001 of F25, whose 409 over an inactive row came from
            // a real UNIQUE. Here no constraint backs the rule, so it does not reach further
            expect(( await createComplication(payload) ).status).toBe(201);
        });

        it('does not run without a term: two free text rows of the same type are both 201', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const payload = { pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Texto libre' };

            expect(( await createComplication(payload) ).status).toBe(201);
            expect(( await createComplication(payload) ).status).toBe(201);
        });

        it('compares resolved terms and not codes: two synonym spellings collide', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const code = `SYN${ suffix }`;
            await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Sinonimo', complicationCode: code
            });

            const response = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Sinonimo',
                complicationCode: `  ${ code.toLowerCase() }  `
            });

            expect(response.status).toBe(409);
        });

    });

    describe('ESAVI-PREGCOMP-002A and 002B — the two listings', () => {

        it('002A returns only active rows and 002B every one, both ordered by sortOrder', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const first = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Primera' });
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Segunda' });
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Tercera' });
            await deleteComplication(first.body.data.complicationId);

            const active = await listActive(pregnancyId);
            expect(active.status).toBe(200);
            expect(active.body.data.count).toBe(2);
            expect(active.body.data.rows.map(( row: { sortOrder: number } ) => row.sortOrder)).toEqual([2, 3]);

            const all = await listAll(pregnancyId);
            expect(all.status).toBe(200);
            expect(all.body.data.count).toBe(3);
            expect(all.body.data.rows.map(( row: { sortOrder: number } ) => row.sortOrder)).toEqual([1, 2, 3]);
            // The row a 005A sealed: exactly what the new index exists to read
            expect(all.body.data.rows[0].deletedAt).not.toBeNull();
        });

        it('answers { count, rows } in both listings', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Unica' });

            for( const response of [ await listActive(pregnancyId), await listAll(pregnancyId) ] ) {
                expect(Object.keys(response.body.data).sort()).toEqual(['count', 'rows']);
            }
        });

        it('honours limit and offset, and reads no other query parameter', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Uno' });
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Dos' });

            const paged = await listActive(pregnancyId, 'USER', '?limit=1&offset=1');
            expect(paged.body.data.count).toBe(2);
            expect(paged.body.data.rows).toHaveLength(1);
            expect(paged.body.data.rows[0].complicationRawName).toBe('Dos');

            const filtered = await listActive(pregnancyId, 'USER', `?complicationTypeItemId=${ typeItemId }&q=Uno`);
            expect(filtered.body.data.rows).toHaveLength(2);
        });

        it('rejects a USER on the 002B', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            expect(( await listAll(pregnancyId, 'USER') ).status).toBe(403);
        });

    });

    describe('the inherited visibility, in a chain of two hops', () => {

        it('an inactive pregnancy answers 404 to USER and ADMIN, and 200 to SUPERADMIN', async () => {
            const { complicationId, pregnancyId } = await newComplication();
            await deactivatePregnancy(pregnancyId);

            expect(( await getComplication(complicationId, 'USER') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'ADMIN') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'SUPERADMIN') ).status).toBe(200);

            expect(( await listActive(pregnancyId, 'USER') ).status).toBe(404);
            expect(( await listAll(pregnancyId, 'ADMIN') ).status).toBe(404);
            expect(( await listActive(pregnancyId, 'SUPERADMIN') ).status).toBe(200);

            expect(( await updateComplication(complicationId, {}) ).status).toBe(404);
            expect(( await updateComplication(complicationId, {}, 'SUPERADMIN') ).status).toBe(200);
        });

        it('an inactive notification answers the same, with the pregnancy still active', async () => {
            const { complicationId, pregnancyId, notificationId } = await newComplication();
            await deactivateNotification(notificationId);

            expect(( await getComplication(complicationId, 'USER') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'ADMIN') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'SUPERADMIN') ).status).toBe(200);

            expect(( await listActive(pregnancyId, 'USER') ).status).toBe(404);
            expect(( await listActive(pregnancyId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('an inactive complication with the whole chain active answers the same', async () => {
            const { complicationId } = await newComplication();
            await deleteComplication(complicationId);

            expect(( await getComplication(complicationId, 'USER') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'ADMIN') ).status).toBe(404);
            expect(( await getComplication(complicationId, 'SUPERADMIN') ).status).toBe(200);
        });

    });

    describe('ESAVI-PREGCOMP-003 — read by id', () => {

        it('returns the declared shape and drops the parent chain', async () => {
            const { complicationId } = await newComplication({ complicationCode: `SHAPE3${ suffix }` });

            const response = await getComplication(complicationId);

            expect(response.status).toBe(200);
            expect(Object.keys(response.body.data).sort()).toEqual([
                'appDetails', 'complicationId', 'complicationRawName', 'complicationType',
                'complicationTypeItemId', 'createdAt', 'deletedAt', 'diagnosticTerm', 'diagnosticTermId',
                'isActive', 'notes', 'pregnancyId', 'sortOrder', 'updatedAt'
            ]);
            expect(response.body.data.pregnancy).toBeUndefined();
        });

        it('answers 404 for an unknown id', async () => {
            const response = await getComplication(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PREGCOMP_003_NOT_FOUND');
        });

        it('does not let /:id swallow the four literal paths', async () => {
            for( const literal of ['activate/algo', 'purge/algo', 'pregnancy/algo', 'admin/pregnancy/algo'] ) {
                const response = await request(app).get(`${ basePath }/${ literal }`).set(authHeader('SUPERADMIN'));
                expect(response.body.code).not.toBe('PREGCOMP_003_NOT_FOUND');
            }
            const badUuid = await request(app).get(`${ basePath }/pregnancy/not-a-uuid`).set(authHeader('USER'));
            expect(badUuid.status).toBe(400);
        });

    });

    describe('ESAVI-PREGCOMP-004 — update', () => {

        it('writes nothing when the PUT resends the response of its GET', async () => {
            const { complicationId } = await newComplication({ notes: 'Detectada en ecografia' });

            await expectPutOfGetResponseWritesNothing({
                path: basePath,
                id: complicationId,
                model: NotificationPregnancyComplication,
                role: 'USER',
                strip: ['diagnosticTermId', 'complicationRawName', 'sortOrder', 'diagnosticTerm', 'complicationType']
            });
        });

        it('writes nothing over a row WHOSE RAW NAME DIVERGES from the master', async () => {
            // The case F16 discovered by breaking it: without the second condition of the
            // incomingName formula, this PUT would wipe what the notifier wrote
            const code = `PUTDIV${ suffix }`;
            const seed = await notifyNewPregnancy();
            await createComplication({
                pregnancyId: seed.pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'Anomalia cardiaca', complicationCode: code
            });
            const { pregnancyId } = await notifyNewPregnancy();
            const created = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'problema del corazon', complicationCode: code
            });
            const id = created.body.data.complicationId;
            expect(created.body.data.complicationRawName).toBe('problema del corazon');

            const versionBefore = await rowVersion(id);
            const auditBefore = ( await auditMethods(id) ).length;

            // The name the GET displays, resent verbatim, is not a rewrite
            const response = await updateComplication(id, {
                complicationName: 'problema del corazon',
                complicationCode: code,
                complicationTypeItemId: typeItemId
            });

            expect(response.status).toBe(200);
            const row = await rowOf(id);
            expect(row?.getDataValue('complicationRawName')).toBe('problema del corazon');
            expect(await rowVersion(id)).toBe(versionBefore);
            expect(( await auditMethods(id) )).toHaveLength(auditBefore);
        });

        it('writes nothing on an empty body', async () => {
            const { complicationId } = await newComplication();
            const versionBefore = await rowVersion(complicationId);

            expect(( await updateComplication(complicationId, {}) ).status).toBe(200);

            expect(await rowVersion(complicationId)).toBe(versionBefore);
        });

        it('moves the two derived fields in a single audit entry when the code changes', async () => {
            const { complicationId } = await newComplication();
            const versionBefore = await rowVersion(complicationId) ?? 0;
            expect(( await rowOf(complicationId) )?.getDataValue('diagnosticTermId')).toBeNull();

            const response = await updateComplication(complicationId, { complicationCode: `NUEVO${ suffix }` });

            expect(response.status).toBe(200);
            expect(response.body.data.diagnosticTermId).not.toBeNull();
            expect(await auditMethods(complicationId)).toEqual(['ESAVI-PREGCOMP-001', 'ESAVI-PREGCOMP-004']);
            expect(await rowVersion(complicationId)).toBe(versionBefore + 1);
        });

        it('ignores pregnancyId and sortOrder without answering 400', async () => {
            const { complicationId } = await newComplication();
            const other = await notifyNewPregnancy();
            const before = await rowOf(complicationId);

            const response = await updateComplication(complicationId, {
                pregnancyId: other.pregnancyId,
                sortOrder: 99
            });

            expect(response.status).toBe(200);
            expect(response.body.data.pregnancyId).toBe(before?.getDataValue('pregnancyId'));
            expect(( await rowOf(complicationId) )?.getDataValue('sortOrder')).toBe(before?.getDataValue('sortOrder'));
            expect(await rowVersion(complicationId)).toBe(( before?.getDataValue('sysDetails') as { version?: number } ).version);
        });

        it('answers 400 for an explicit null on complicationTypeItemId and complicationName', async () => {
            const { complicationId } = await newComplication();

            expect(( await updateComplication(complicationId, { complicationTypeItemId: null }) ).status).toBe(400);
            expect(( await updateComplication(complicationId, { complicationName: null }) ).status).toBe(400);
            // notes is nullable, unlike those two
            expect(( await updateComplication(complicationId, { notes: null }) ).status).toBe(200);
        });

        it('revalidates the type when it arrives and answers 404 for an invalid one', async () => {
            const { complicationId } = await newComplication();

            for( const complicationTypeItemId of [inactiveTypeItemId, femaleItemId, unknownUuid] ) {
                const response = await updateComplication(complicationId, { complicationTypeItemId });
                expect(response.status).toBe(404);
                expect(response.body.code).toBe('PREGCOMP_004_COMPLICATION_TYPE_NOT_FOUND');
            }

            const valid = await updateComplication(complicationId, { complicationTypeItemId: otherTypeItemId });
            expect(valid.status).toBe(200);
            expect(valid.body.data.complicationTypeItemId).toBe(otherTypeItemId);
        });

        it('answers 409 when the resulting pair lands on a live sister, 200 over itself', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const code = `DUP4${ suffix }`;
            const first = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Una', complicationCode: code
            });
            const second = await createComplication({
                pregnancyId, complicationTypeItemId: otherTypeItemId, complicationName: 'Otra', complicationCode: code
            });

            const versionBefore = await rowVersion(first.body.data.complicationId);
            const itself = await updateComplication(first.body.data.complicationId, {
                complicationCode: code, complicationTypeItemId: typeItemId
            });
            expect(itself.status).toBe(200);
            expect(await rowVersion(first.body.data.complicationId)).toBe(versionBefore);

            const collision = await updateComplication(second.body.data.complicationId, {
                complicationTypeItemId: typeItemId
            });
            expect(collision.status).toBe(409);
            expect(collision.body.code).toBe('PREGCOMP_004_ALREADY_EXISTS');
        });

        it('trims notes before comparing, and clears them with an empty string', async () => {
            const { complicationId } = await newComplication({ notes: 'Detectada en ecografia' });
            const versionBefore = await rowVersion(complicationId);

            expect(( await updateComplication(complicationId, { notes: '  Detectada en ecografia  ' }) ).status).toBe(200);
            expect(await rowVersion(complicationId)).toBe(versionBefore);

            expect(( await updateComplication(complicationId, { notes: '' }) ).status).toBe(200);
            expect(( await rowOf(complicationId) )?.getDataValue('notes')).toBeNull();
        });

        it('answers 404 on an external source that does not resolve, creating nothing', async () => {
            const { complicationId } = await newComplication();
            const before = await DiagnosticTerm.count();

            const response = await updateComplication(complicationId, {
                complicationCode: `NOPE4${ suffix }`, source: 'MEDDRA'
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('PREGCOMP_004_DIAGTERM_NOT_FOUND');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

    });

    describe('ESAVI-PREGCOMP-005A — deactivate', () => {

        it('seals deletedAt and answers 409 the second time', async () => {
            const { complicationId } = await newComplication();

            const response = await deleteComplication(complicationId);
            expect(response.status).toBe(200);

            const row = await rowOf(complicationId);
            expect(row?.getDataValue('isActive')).toBe(false);
            expect(row?.getDataValue('deletedAt')).not.toBeNull();
            expect(await auditMethods(complicationId)).toEqual(['ESAVI-PREGCOMP-001', 'ESAVI-PREGCOMP-005A']);

            const again = await deleteComplication(complicationId);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('PREGCOMP_005A_ALREADY_INACTIVE');
        });

        it('rejects a USER', async () => {
            const { complicationId } = await newComplication();

            expect(( await deleteComplication(complicationId, 'USER') ).status).toBe(403);
        });

        it('frees the sortOrder for the next complication', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'A' });
            const second = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'B' });

            await deleteComplication(second.body.data.complicationId);

            const third = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'C' });
            expect(third.body.data.sortOrder).toBe(2);
        });

        it('does not touch the parent when the last live complication is withdrawn', async () => {
            const { complicationId, pregnancyId } = await newComplication();
            const parentBefore = await NotificationPregnancy.findByPk(pregnancyId);
            const versionBefore = ( parentBefore!.getDataValue('sysDetails') as { version?: number } | null )?.version;
            const updatedAtBefore = parentBefore!.getDataValue('updatedAt');

            await deleteComplication(complicationId);

            const parentAfter = await NotificationPregnancy.findByPk(pregnancyId);
            expect(( parentAfter!.getDataValue('sysDetails') as { version?: number } | null )?.version).toBe(versionBefore);
            expect(parentAfter!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
        });

    });

    describe('ESAVI-PREGCOMP-005B — reactivate', () => {

        // The trigger assigns COALESCE(MAX(sortOrder), 0) + 1 over the LIVE rows, so it does not
        // refill gaps: a number is only reused when the row retired was the last one. That is the
        // shape the collision really takes, and this is the scenario that fails loudly if anyone
        // delegates the 005B the way the parent F25 legitimately could
        it('THE COLLISION: create A and B, retire B, create C, reactivate B', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const a = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'A' });
            const b = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'B' });
            expect([ a.body.data.sortOrder, b.body.data.sortOrder ]).toEqual([1, 2]);

            await deleteComplication(b.body.data.complicationId);
            const c = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'C' });
            expect(c.body.data.sortOrder).toBe(2);

            const response = await activateComplication(b.body.data.complicationId);

            expect(response.status).toBe(200);
            expect(( await rowOf(b.body.data.complicationId) )?.getDataValue('sortOrder')).toBe(3);
            expect(( await rowOf(a.body.data.complicationId) )?.getDataValue('sortOrder')).toBe(1);
            expect(( await rowOf(c.body.data.complicationId) )?.getDataValue('sortOrder')).toBe(2);
            expect(await auditMethods(b.body.data.complicationId))
                .toEqual(['ESAVI-PREGCOMP-001', 'ESAVI-PREGCOMP-005A', 'ESAVI-PREGCOMP-005B']);
        });

        // The variant that does NOT collide: retiring the FIRST row leaves a gap the trigger never
        // refills, so C is born with 3 and reactivating A finds nothing in its way. It answers 200
        // all the same and A keeps its number
        it('does not touch sortOrder when there is no collision', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const a = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'A' });
            const b = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'B' });
            await deleteComplication(a.body.data.complicationId);

            const c = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'C' });
            expect(c.body.data.sortOrder).toBe(3);

            expect(( await activateComplication(a.body.data.complicationId) ).status).toBe(200);

            expect(( await rowOf(a.body.data.complicationId) )?.getDataValue('sortOrder')).toBe(1);
            expect(( await rowOf(b.body.data.complicationId) )?.getDataValue('sortOrder')).toBe(2);
        });

        it('answers 409 over an already active row and 404 over an unknown id', async () => {
            const { complicationId } = await newComplication();

            const active = await activateComplication(complicationId);
            expect(active.status).toBe(409);
            expect(active.body.code).toBe('PREGCOMP_005B_ALREADY_ACTIVE');

            const unknown = await activateComplication(unknownUuid);
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('PREGCOMP_005B_NOT_FOUND');
        });

        it('rejects a USER and an ADMIN', async () => {
            const { complicationId } = await newComplication();
            await deleteComplication(complicationId);

            expect(( await activateComplication(complicationId, 'USER') ).status).toBe(403);
            expect(( await activateComplication(complicationId, 'ADMIN') ).status).toBe(403);
        });

        it('revalidates nothing: a retired pregnancy still answers 200', async () => {
            const { complicationId, pregnancyId } = await newComplication();
            await deleteComplication(complicationId);
            await deactivatePregnancy(pregnancyId);

            expect(( await activateComplication(complicationId) ).status).toBe(200);
        });

        // The assumed consequence of SPEC F27 §6. It is mounted as an explicit scenario so nobody
        // "fixes" the 005B into a 409 without reading why: a 005B that refuses leaves a SUPERADMIN
        // with a row that can never come back and nothing to do about it but purge it
        it('ASSUMED: reactivating a row whose pair is already live answers 200 and duplicates it', async () => {
            const { pregnancyId } = await notifyNewPregnancy();
            const payload = {
                pregnancyId, complicationTypeItemId: typeItemId,
                complicationName: 'Revivible', complicationCode: `REVIVE${ suffix }`
            };
            const first = await createComplication(payload);
            await deleteComplication(first.body.data.complicationId);
            const second = await createComplication(payload);
            expect(second.status).toBe(201);

            expect(( await activateComplication(first.body.data.complicationId) ).status).toBe(200);

            const live = await NotificationPregnancyComplication.count({
                where: {
                    pregnancyId,
                    diagnosticTermId: second.body.data.diagnosticTermId,
                    complicationTypeItemId: typeItemId,
                    isActive: true
                }
            });
            expect(live).toBe(2);
        });

    });

    describe('ESAVI-PREGCOMP-005C — physical delete', () => {

        it('answers 409 over an active row and destroys a retired one', async () => {
            const { complicationId } = await newComplication({ complicationCode: `PURGE${ suffix }` });
            const termId = ( await rowOf(complicationId) )?.getDataValue('diagnosticTermId');

            const stillActive = await purgeComplication(complicationId);
            expect(stillActive.status).toBe(409);
            expect(stillActive.body.code).toBe('PREGCOMP_005C_STILL_ACTIVE');

            await deleteComplication(complicationId);
            const purged = await purgeComplication(complicationId);
            expect(purged.status).toBe(200);

            expect(await rowOf(complicationId)).toBeNull();
            // The two masters it cited survive: the foreign keys are RESTRICT the other way round
            expect(await DiagnosticTerm.findByPk(termId as string)).not.toBeNull();
            expect(await CatalogItem.findByPk(typeItemId)).not.toBeNull();
        });

        it('answers 404 for an unknown id and rejects a USER and an ADMIN', async () => {
            const { complicationId } = await newComplication();
            await deleteComplication(complicationId);

            expect(( await purgeComplication(complicationId, 'USER') ).status).toBe(403);
            expect(( await purgeComplication(complicationId, 'ADMIN') ).status).toBe(403);

            const unknown = await purgeComplication(unknownUuid);
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('PREGCOMP_005C_NOT_FOUND');
        });

    });

    describe('the cascade of ESAVI-NOTIFCN-005C', () => {

        const readLog = (): string => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';

        const purgeNotification = async ( notificationId: string ) => {
            await deactivateNotification(notificationId);
            return request(app).delete(`/api/notifications/purge/${ notificationId }`).set(authHeader('SUPERADMIN'));
        };

        it('dumps one warn line with the ids the third hop destroys', async () => {
            const { pregnancyId, notificationId } = await notifyNewPregnancy();
            const first = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Primera' });
            const second = await createComplication({ pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Segunda' });

            const before = readLog().length;
            expect(( await purgeNotification(notificationId) ).status).toBe(200);
            const written = readLog().slice(before);

            const lines = written.split('\n').filter(line => line.includes('notificationPregnancyComplication row(s) dragged'));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('2 notificationPregnancyComplication row(s) dragged');
            expect(lines[0]).toContain('third hop');
            expect(lines[0]).toContain(first.body.data.complicationId);
            expect(lines[0]).toContain(second.body.data.complicationId);

            // The pregnancy line of F25 still comes out, and before this one
            expect(written.indexOf('notificationPregnancy row dragged'))
                .toBeLessThan(written.indexOf('notificationPregnancyComplication row(s) dragged'));

            // And the cascade really destroyed them
            expect(await NotificationPregnancyComplication.count({ where: { pregnancyId } })).toBe(0);
        });

        it('leaves no line when the pregnancy carries no complications', async () => {
            const { notificationId } = await notifyNewPregnancy();

            const before = readLog().length;
            await purgeNotification(notificationId);

            expect(readLog().slice(before)).not.toContain('notificationPregnancyComplication row(s) dragged');
        });

    });

    describe('the entity as a whole', () => {

        it('walks the eight operations end to end', async () => {
            const { pregnancyId } = await notifyNewPregnancy();

            const created = await createComplication({
                pregnancyId, complicationTypeItemId: typeItemId, complicationName: 'Recorrido completo'
            });
            expect(created.status).toBe(201);
            const id = created.body.data.complicationId;

            expect(( await listActive(pregnancyId) ).body.data.count).toBe(1);
            expect(( await listAll(pregnancyId) ).body.data.count).toBe(1);
            expect(( await getComplication(id) ).status).toBe(200);
            expect(( await updateComplication(id, { notes: 'Revisada' }) ).status).toBe(200);
            expect(( await deleteComplication(id) ).status).toBe(200);
            expect(( await activateComplication(id) ).status).toBe(200);
            expect(( await deleteComplication(id) ).status).toBe(200);
            expect(( await purgeComplication(id) ).status).toBe(200);

            expect(await rowOf(id)).toBeNull();
        });

        it('carries the nine new keys in the three languages', async () => {
            const keys = [
                'notFound', 'idRequired', 'pregnancyNotFound', 'complicationTypeNotFound',
                'diagnosticTermNotFound', 'alreadyExists', 'nameRequired',
                'complicationTypeRequired', 'stillActive'
            ] as const;

            for( const catalog of [es, en, nl] ) {
                for( const key of keys ) {
                    expect(catalog.notificationPregnancyComplication[key]).toBeTruthy();
                }
            }
        });

        it('says ACTIVE in the alreadyExists message, never pointing at the activation', async () => {
            // The opposite of notificationPregnancy.alreadyExists, which does point at /activate/:id
            // because a real UNIQUE keeps the slot taken. Here the guard only looks at active rows,
            // so reloading is the correction path and the message must not suggest reactivating
            for( const catalog of [es, en, nl] ) {
                expect(catalog.notificationPregnancyComplication.alreadyExists).not.toContain('/activate/');
            }
        });

    });

});
