import request from 'supertest';
import { DiagnosticTerm, EsaviCase, HealthFacility, Notification, NotificationMedicalHistory, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import * as logHelper from '../../src/helpers/esaviLogs.helper';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine notificationMedicalHistory operations of SPEC F57. It walks
 * the entity end to end — create, read by id, list by notification, admin list, list by
 * case, update, deactivate, reactivate, purge — and covers what cannot be checked by hand
 * reliably.
 *
 * This is the sixth satellite of notification and the fourth one to many, so it inherits
 * the sortOrder collision F16 faced and F21, F22, F24, F27, F31 and F33 reconfirmed: the
 * partial unique index is conditioned by deletedAt, so a 005A frees the number, a later
 * create reuses it, and reactivating the old row would blow the index up. The suite runs
 * those four movements literally and expects the reactivated antecedent at the end of the
 * list.
 *
 * Three axes are proper to this entity. The resolution against the clinical master in its
 * three branches — no code, LOCAL which coins the term, an external source which never
 * does — and the two derived fields it leaves behind, diagnosticTermId and historyRaw,
 * with no third field denormalizing the canonical name. The duplicate guard over the
 * resolved term, which is a business rule of the service backed by no constraint and
 * therefore compares against active rows only. And the deliberate decoupling from the
 * parent's flag: nothing here reads or writes notification.hasRelevantMedicalHistory, so
 * a notification answering 'NO' takes an antecedent and answers 201.
 *
 * The fourth axis is the differential update, which here is the derived case of F12: two
 * candidates that enter always because they are recomputed rather than compared, one
 * nullable that enters by presence, and two immutables that never enter.
 */
describe('notificationMedicalHistory contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const basePath = '/api/notification-medical-histories';

    // errorHandler logs every error it handles, and a third of these tests trigger errors
    // on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;

    beforeAll(async () => {
        await seedTestUsers();
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // A case with no notification yet, which is the second 404 of the 006
    const newCase = async (): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`MH ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`MH${ counter }${ suffix }`),
            healthSystemCode: `MH${ counter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `MH${ counter }${ suffix }`,
            name: `MH ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `MH-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification over a brand new case. The antecedents are recorded the same way whether
    // the notification is severe or not, so the type is fixed and only the dedicated test
    // varies it
    const notifyNewCase = async ( notificationType: string = 'NON_SEVERE' ): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await newCase();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType, esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const create = ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).post(basePath).set(authHeader(role)).send(payload);

    const getById = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`${ basePath }/${ id }`).set(authHeader(role));

    const listByNotification = ( notificationId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`${ basePath }/notification/${ notificationId }${ query }`).set(authHeader(role));

    const listAllByNotification = ( notificationId: string, role: TestRole = 'ADMIN', query: string = '' ) =>
        request(app).get(`${ basePath }/admin/notification/${ notificationId }${ query }`).set(authHeader(role));

    const listByCase = ( caseId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`${ basePath }/case/${ caseId }${ query }`).set(authHeader(role));

    const update = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`${ basePath }/${ id }`).set(authHeader(role)).send(payload);

    const remove = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`${ basePath }/${ id }`).set(authHeader(role));

    const activate = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`${ basePath }/activate/${ id }`).set(authHeader(role));

    const purge = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    const purgeNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/purge/${ id }`).set(authHeader('SUPERADMIN'));

    // Seals a row the way a 005A does, without going through the endpoint
    const seal = ( medicalHistoryId: string ) => NotificationMedicalHistory.update(
        { isActive: false, deletedAt: new Date() },
        { where: { medicalHistoryId } }
    );

    // The whole write footprint of a row, so a test can assert "nothing was written"
    const snapshot = async ( id: string ) => {
        const row = await NotificationMedicalHistory.findByPk(id);
        return {
            updatedAt: row!.getDataValue('updatedAt'),
            version: ( row!.getDataValue('sysDetails') as { version?: number } | null )?.version,
            appDetails: ( row!.getDataValue('appDetails') as unknown[] ).length,
            sortOrder: row!.getDataValue('sortOrder'),
            notificationId: row!.getDataValue('notificationId')
        };
    };

    const sortOrderOf = async ( id: string ) =>
        ( await NotificationMedicalHistory.findByPk(id) )!.getDataValue('sortOrder');

    // Three antecedents over one notification: two alive, one sealed with deletedAt the way
    // a 005A does it. It is what the two listings are contrasted against
    const seedThree = async () => {
        const { notificationId } = await notifyNewCase();
        const a = await create({ notificationId, historyName: 'Asma' });
        const b = await create({ notificationId, historyName: 'Bronquitis' });
        const c = await create({ notificationId, historyName: 'Cardiopatia' });
        await seal(b.body.data.medicalHistoryId);
        return {
            notificationId,
            aliveIds: [ a.body.data.medicalHistoryId, c.body.data.medicalHistoryId ],
            sealedId: b.body.data.medicalHistoryId
        };
    };

    // Captures the warn lines the cascade dump writes, without touching the log file
    const captureLogs = () => {
        const lines: { message: string, level: string }[] = [];
        const spy = jest.spyOn(logHelper, 'esaviLog').mockImplementation((( message: string, level: string ) => {
            lines.push({ message, level });
        }) as never);
        return { lines, restore: () => spy.mockRestore() };
    };

    describe('ESAVI-MEDHIST-001 - create', () => {

    it('alta minima: 201, diagnosticTermId null, historyRaw con el texto, sortOrder 1 y luego 2', async () => {
        const { notificationId } = await notifyNewCase();
        const first = await create({ notificationId, historyName: '  Asma  ' });
        expect(first.status).toBe(201);
        expect(first.body.data).toMatchObject({
            diagnosticTermId: null, historyRaw: 'Asma', notes: null, sortOrder: 1, isActive: true
        });
        expect(first.body.data.diagnosticTerm).toBeNull();
        expect(first.body.data.sysDetails).toBeUndefined();
        expect(first.body.data.appDetails).toHaveLength(1);
        expect(first.body.data.appDetails[0].method).toBe('ESAVI-MEDHIST-001');

        const second = await create({ notificationId, historyName: 'Diabetes' });
        expect(second.status).toBe(201);
        expect(second.body.data.sortOrder).toBe(2);
    });

    it('el INSERT emitido no contiene la columna sortOrder', async () => {
        const { notificationId } = await notifyNewCase();
        const statements: string[] = [];
        const db = NotificationMedicalHistory.sequelize as unknown as { options: { logging: unknown } };
        const previousLogging = db.options.logging;
        db.options.logging = (sql: string) => { statements.push(sql); };
        await create({ notificationId, historyName: 'Hipertension' });
        db.options.logging = previousLogging;
        const insert = statements.find(s => s.includes('INSERT INTO "notificationMedicalHistory"'));
        expect(insert).toBeDefined();
        // Only the written column list matters. sortOrder does come back in the RETURNING clause,
        // which is how Sequelize reads the value the trigger assigned - that is a read, not a write
        const writtenColumns = insert!.slice(insert!.indexOf('('), insert!.indexOf(' VALUES'));
        expect(writtenColumns).not.toContain('sortOrder');
        expect(insert).toContain('RETURNING');
    });

    it('historyCode nuevo sin source: crea el termino LOCAL, historyRaw null si el nombre coincide', async () => {
        const { notificationId } = await notifyNewCase();
        const r = await create({ notificationId, historyName: 'Asma bronquial', historyCode: `mh-${ suffix }-a` });
        expect(r.status).toBe(201);
        expect(r.body.data.diagnosticTermId).not.toBeNull();
        expect(r.body.data.historyRaw).toBeNull();
        expect(r.body.data.diagnosticTerm).toMatchObject({ source: 'LOCAL', name: 'Asma bronquial' });
        expect(Object.keys(r.body.data.diagnosticTerm).sort())
            .toEqual(['code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup']);
    });

    it('historyCode existente con nombre distinto: historyRaw guarda el texto del notificador', async () => {
        const { notificationId } = await notifyNewCase();
        const code = `mh-${ suffix }-b`;
        await create({ notificationId, historyName: 'Canonico', historyCode: code });
        const { notificationId: n2 } = await notifyNewCase();
        const r = await create({ notificationId: n2, historyName: 'Lo que escribio el notificador', historyCode: code });
        expect(r.status).toBe(201);
        expect(r.body.data.historyRaw).toBe('Lo que escribio el notificador');
        expect(r.body.data.diagnosticTerm.name).toBe('Canonico');
    });

    it('source MEDDRA con codigo inexistente: 404 y no se crea ningun termino', async () => {
        const { notificationId } = await notifyNewCase();
        const before = await DiagnosticTerm.count();
        const r = await create({ notificationId, historyName: 'X', historyCode: `nope-${ suffix }`, source: 'MEDDRA' });
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_001_DIAGTERM_NOT_FOUND');
        expect(await DiagnosticTerm.count()).toBe(before);
    });

    it('notificacion inexistente o inactiva: 404, tambien como SUPERADMIN', async () => {
        const unknown = '00000000-0000-4000-8000-000000000000';
        for (const role of ['USER', 'SUPERADMIN'] as TestRole[]) {
            const r = await create({ notificationId: unknown, historyName: 'Asma' }, role);
            expect(r.status).toBe(404);
            expect(r.body.code).toBe('MEDHIST_001_NOTIFICATION_NOT_FOUND');
        }
        const { notificationId } = await notifyNewCase();
        await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));
        for (const role of ['USER', 'SUPERADMIN'] as TestRole[]) {
            const r = await create({ notificationId, historyName: 'Asma' }, role);
            expect(r.status).toBe(404);
            expect(r.body.code).toBe('MEDHIST_001_NOTIFICATION_NOT_FOUND');
        }
    });

    it('mismo termino activo: 409; si el que lo tiene esta inactivo: 201', async () => {
        const { notificationId } = await notifyNewCase();
        const code = `mh-${ suffix }-c`;
        const first = await create({ notificationId, historyName: 'Repetido', historyCode: code });
        expect(first.status).toBe(201);
        const dup = await create({ notificationId, historyName: 'Repetido', historyCode: code });
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('MEDHIST_001_ALREADY_EXISTS');

        await NotificationMedicalHistory.update(
            { isActive: false, deletedAt: new Date() },
            { where: { medicalHistoryId: first.body.data.medicalHistoryId } }
        );
        const again = await create({ notificationId, historyName: 'Repetido', historyCode: code });
        expect(again.status).toBe(201);
    });

    it('mismo texto dos veces sin historyCode: 201 las dos, dos filas', async () => {
        const { notificationId } = await notifyNewCase();
        expect((await create({ notificationId, historyName: 'Alergia' })).status).toBe(201);
        expect((await create({ notificationId, historyName: 'Alergia' })).status).toBe(201);
        expect(await NotificationMedicalHistory.count({ where: { notificationId } })).toBe(2);
    });

    it('hasRelevantMedicalHistory en NO / UNKNOWN / null: 201 y la columna no cambia', async () => {
        for (const flag of ['NO', 'UNKNOWN', null]) {
            const { notificationId } = await notifyNewCase();
            if (flag) {
                await Notification.update(
                    { hasRelevantMedicalHistory: flag } as never,
                    { where: { notificationId } }
                );
            }
            const before = await Notification.findByPk(notificationId);
            const beforeFlag = before!.get('hasRelevantMedicalHistory' as never);
            const beforeUpdatedAt = before!.get('updatedAt' as never);

            const r = await create({ notificationId, historyName: 'Asma' });
            expect(r.status).toBe(201);

            const after = await Notification.findByPk(notificationId);
            expect(after!.get('hasRelevantMedicalHistory' as never)).toEqual(beforeFlag);
            expect(after!.get('updatedAt' as never)).toEqual(beforeUpdatedAt);
        }
    });

    it('notificationType no altera el resultado: SEVERE se comporta como NON_SEVERE', async () => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`MHS ${ counter }`), lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`MHS${ counter }${ suffix }`),
            healthSystemCode: `MHS${ counter }${ suffix }`, birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({ localCode: `MHS${ counter }${ suffix }`, name: `MHS ${ counter } ${ suffix }` });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `MHS-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10), eventDate: '2024-05-04'
        });
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        const created = await request(app).post('/api/notifications').set(authHeader('USER'))
            .send({ caseId: esaviCase.getDataValue('caseId'), notificationType: 'SEVERE', esaviDescription: 'Serious' });
        const r = await create({ notificationId: created.body.data.notificationId, historyName: 'Asma' });
        expect(r.status).toBe(201);
        expect(r.body.data.sortOrder).toBe(1);
    });

    it('notes se normaliza con trim y un texto en blanco queda null', async () => {
        const { notificationId } = await notifyNewCase();
        const r = await create({ notificationId, historyName: 'Asma', notes: '   ' });
        expect(r.status).toBe(201);
        expect(r.body.data.notes).toBeNull();
        const r2 = await create({ notificationId, historyName: 'Otra', notes: '  con espacios  ' });
        expect(r2.body.data.notes).toBe('con espacios');
    });

    });

    describe('ESAVI-MEDHIST-003 - get by id', () => {

    it('devuelve la forma exacta de 3.7, con diagnosticTerm anidado de seis campos', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma bronquial', historyCode: `st9-${ suffix }`, notes: 'desde la infancia' });

        const r = await getById(created.body.data.medicalHistoryId);
        expect(r.status).toBe(200);
        expect(Object.keys(r.body.data).sort()).toEqual([
            'appDetails', 'createdAt', 'deletedAt', 'diagnosticTerm', 'diagnosticTermId',
            'historyRaw', 'isActive', 'medicalHistoryId', 'notes', 'notificationId',
            'sortOrder', 'updatedAt'
        ]);
        expect(Object.keys(r.body.data.diagnosticTerm).sort()).toEqual([
            'code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup'
        ]);
        expect(r.body.data.diagnosticTerm.metadata).toBeUndefined();
    });

    it('diagnosticTerm es null explicito cuando el antecedente no tiene termino', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Texto libre' });
        const r = await getById(created.body.data.medicalHistoryId);
        expect(r.status).toBe(200);
        expect(r.body.data.diagnosticTermId).toBeNull();
        expect(r.body.data.diagnosticTerm).toBeNull();
        expect(r.body.data.historyRaw).toBe('Texto libre');
    });

    it('sysDetails y hasRelevantMedicalHistory no aparecen en el payload', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const r = await getById(created.body.data.medicalHistoryId);
        expect(r.body.data.sysDetails).toBeUndefined();
        expect(r.body.data.hasRelevantMedicalHistory).toBeUndefined();
        expect(r.body.data.notification).toBeUndefined();
    });

    it('id inexistente: 404 MEDHIST_003_NOT_FOUND con cualquier rol', async () => {
        for (const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const r = await getById(unknownUuid, role);
            expect(r.status).toBe(404);
            expect(r.body.code).toBe('MEDHIST_003_NOT_FOUND');
        }
    });

    it('motivo 1 — antecedente inactivo: 404 para USER y ADMIN, 200 para SUPERADMIN', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await seal(id);

        expect((await getById(id, 'USER')).status).toBe(404);
        expect((await getById(id, 'ADMIN')).status).toBe(404);
        const superUser = await getById(id, 'SUPERADMIN');
        expect(superUser.status).toBe(200);
        expect(superUser.body.data.isActive).toBe(false);
    });

    it('motivo 2 — antecedente activo con notificacion inactiva: 404 USER y ADMIN, 200 SUPERADMIN', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await deactivateNotification(notificationId);

        expect((await getById(id, 'USER')).status).toBe(404);
        expect((await getById(id, 'ADMIN')).status).toBe(404);
        const superUser = await getById(id, 'SUPERADMIN');
        expect(superUser.status).toBe(200);
        expect(superUser.body.data.isActive).toBe(true);
    });

    it('los dos motivos combinados: 404 USER y ADMIN, 200 SUPERADMIN', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await seal(id);
        await deactivateNotification(notificationId);

        expect((await getById(id, 'USER')).status).toBe(404);
        expect((await getById(id, 'ADMIN')).status).toBe(404);
        expect((await getById(id, 'SUPERADMIN')).status).toBe(200);
    });

    it('el 003 no es el acceso por notificacion: un notificationId responde 404', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Asma' });
        const r = await getById(notificationId, 'USER');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_003_NOT_FOUND');
    });

    it('las literales no caen en el validador de UUID del :id', async () => {
        const { notificationId } = await notifyNewCase();
        expect((await request(app).get(`/api/notification-medical-histories/notification/${ notificationId }`).set(authHeader('USER'))).status).toBe(200);
        expect((await request(app).get(`/api/notification-medical-histories/admin/notification/${ notificationId }`).set(authHeader('ADMIN'))).status).toBe(200);
        expect((await getById('no-es-uuid')).status).toBe(400);
    });

    });

    describe('ESAVI-MEDHIST-002A / 002B - the two listings by notification', () => {

    it('002A devuelve solo activos; 002B tambien los inactivos y los de deletedAt sellado', async () => {
        const { notificationId, aliveIds, sealedId } = await seedThree();

        const active = await listByNotification(notificationId);
        expect(active.status).toBe(200);
        expect(active.body.data.count).toBe(2);
        expect(active.body.data.rows.map((r: { medicalHistoryId: string }) => r.medicalHistoryId)).toEqual(aliveIds);

        const all = await listAllByNotification(notificationId);
        expect(all.status).toBe(200);
        expect(all.body.data.count).toBe(3);
        const sealed = all.body.data.rows.find((r: { medicalHistoryId: string }) => r.medicalHistoryId === sealedId);
        expect(sealed).toBeDefined();
        expect(sealed.isActive).toBe(false);
        expect(sealed.deletedAt).not.toBeNull();
    });

    it('los dos devuelven { count, rows } ordenados por sortOrder ascendente', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        await create({ notificationId, historyName: 'Dos' });
        await create({ notificationId, historyName: 'Tres' });

        for (const r of [await listByNotification(notificationId), await listAllByNotification(notificationId)]) {
            expect(Object.keys(r.body.data).sort()).toEqual(['count', 'rows']);
            const orders = r.body.data.rows.map((x: { sortOrder: number }) => x.sortOrder);
            expect(orders).toEqual([...orders].sort((p: number, q: number) => p - q));
            expect(orders).toEqual([1, 2, 3]);
        }
    });

    it('notificacion sin antecedentes: 200 con { count: 0, rows: [] }', async () => {
        const { notificationId } = await notifyNewCase();
        for (const r of [await listByNotification(notificationId), await listAllByNotification(notificationId)]) {
            expect(r.status).toBe(200);
            expect(r.body.data).toEqual({ count: 0, rows: [] });
        }
    });

    it('notificacion inexistente: 404 con cualquier rol', async () => {
        for (const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const r = await listByNotification(unknownUuid, role);
            expect(r.status).toBe(404);
            expect(r.body.code).toBe('MEDHIST_002A_NOTIFICATION_NOT_FOUND');
        }
        for (const role of ['ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const r = await listAllByNotification(unknownUuid, role);
            expect(r.status).toBe(404);
            expect(r.body.code).toBe('MEDHIST_002B_NOTIFICATION_NOT_FOUND');
        }
    });

    it('notificacion inactiva: 404 para USER y ADMIN, 200 para SUPERADMIN', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Asma' });
        await deactivateNotification(notificationId);

        expect((await listByNotification(notificationId, 'USER')).status).toBe(404);
        expect((await listByNotification(notificationId, 'ADMIN')).status).toBe(404);
        const superUser = await listByNotification(notificationId, 'SUPERADMIN');
        expect(superUser.status).toBe(200);
        expect(superUser.body.data.count).toBe(1);

        expect((await listAllByNotification(notificationId, 'ADMIN')).status).toBe(404);
        expect((await listAllByNotification(notificationId, 'SUPERADMIN')).status).toBe(200);
    });

    it('el 002B con rol USER responde 403', async () => {
        const { notificationId } = await notifyNewCase();
        expect((await listAllByNotification(notificationId, 'USER')).status).toBe(403);
    });

    it('?limit=1&offset=1 devuelve la segunda fila con el count total', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        await create({ notificationId, historyName: 'Tres' });

        const r = await listByNotification(notificationId, 'USER', '?limit=1&offset=1');
        expect(r.status).toBe(200);
        expect(r.body.data.count).toBe(3);
        expect(r.body.data.rows).toHaveLength(1);
        expect(r.body.data.rows[0].medicalHistoryId).toBe(second.body.data.medicalHistoryId);
    });

    it('ningun parametro de query distinto de limit, offset y lang altera el resultado', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        await create({ notificationId, historyName: 'Dos', historyCode: `st8-${ suffix }` });

        const plain = await listByNotification(notificationId);
        const noisy = await listByNotification(notificationId, 'USER', '?isActive=false&diagnosticTermId=x&search=Uno&sortOrder=9&order=desc');
        expect(noisy.status).toBe(200);
        expect(noisy.body.data).toEqual(plain.body.data);
    });

    it('las filas llevan diagnosticTerm y nunca sysDetails ni la notificacion', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Con termino', historyCode: `st8b-${ suffix }` });
        await create({ notificationId, historyName: 'Sin termino' });

        const r = await listByNotification(notificationId);
        expect(r.body.data.rows[0].diagnosticTerm).toMatchObject({ source: 'LOCAL' });
        expect(r.body.data.rows[1].diagnosticTerm).toBeNull();
        for (const row of r.body.data.rows) {
            expect(row.sysDetails).toBeUndefined();
            expect(row.notification).toBeUndefined();
            expect(row.hasRelevantMedicalHistory).toBeUndefined();
        }
    });

    });

    describe('ESAVI-MEDHIST-006 - the listing by case', () => {

    it('caso activo con notificacion: devuelve los activos ordenados por sortOrder', async () => {
        const { notificationId, caseId } = await notifyNewCase();
        const a = await create({ notificationId, historyName: 'Asma' });
        await create({ notificationId, historyName: 'Bronquitis' });
        const c = await create({ notificationId, historyName: 'Cardiopatia' });

        const r = await listByCase(caseId);
        expect(r.status).toBe(200);
        expect(Object.keys(r.body.data).sort()).toEqual(['count', 'rows']);
        expect(r.body.data.count).toBe(3);
        expect(r.body.data.rows.map((x: { sortOrder: number }) => x.sortOrder)).toEqual([1, 2, 3]);
        expect(r.body.data.rows[0].medicalHistoryId).toBe(a.body.data.medicalHistoryId);
        expect(r.body.data.rows[2].medicalHistoryId).toBe(c.body.data.medicalHistoryId);
        // The rows carry the notificationId, which is the entry to the 002B
        expect(r.body.data.rows[0].notificationId).toBe(notificationId);
    });

    it('caseId inexistente o inactivo: 404 MEDHIST_006_CASE_NOT_FOUND', async () => {
        const r = await listByCase(unknownUuid);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_006_CASE_NOT_FOUND');

        const { caseId } = await notifyNewCase();
        await EsaviCase.update({ isActive: false, deletedAt: new Date() }, { where: { caseId } });
        const inactive = await listByCase(caseId);
        expect(inactive.status).toBe(404);
        expect(inactive.body.code).toBe('MEDHIST_006_CASE_NOT_FOUND');
    });

    it('caso activo sin notificacion: 404 MEDHIST_006_NOTIFICATION_NOT_FOUND', async () => {
        const caseId = await newCase();
        const r = await listByCase(caseId);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_006_NOTIFICATION_NOT_FOUND');
    });

    it('caso con notificacion y sin antecedentes: 200 con { count: 0, rows: [] }', async () => {
        const { caseId } = await notifyNewCase();
        const r = await listByCase(caseId);
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ count: 0, rows: [] });
    });

    it('no devuelve antecedentes inactivos ni siquiera como SUPERADMIN', async () => {
        const { notificationId, caseId } = await notifyNewCase();
        const alive = await create({ notificationId, historyName: 'Viva' });
        const sealed = await create({ notificationId, historyName: 'Retirada' });
        await NotificationMedicalHistory.update(
            { isActive: false, deletedAt: new Date() },
            { where: { medicalHistoryId: sealed.body.data.medicalHistoryId } }
        );

        for (const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[]) {
            const r = await listByCase(caseId, role);
            expect(r.status).toBe(200);
            expect(r.body.data.count).toBe(1);
            expect(r.body.data.rows[0].medicalHistoryId).toBe(alive.body.data.medicalHistoryId);
        }

        // The 002B is the door for the retired ones, entered with the notificationId the 006 returns
        const admin = await request(app)
            .get(`/api/notification-medical-histories/admin/notification/${ notificationId }`)
            .set(authHeader('ADMIN'));
        expect(admin.body.data.count).toBe(2);
    });

    it('el rol minimo es USER', async () => {
        const { caseId } = await notifyNewCase();
        for (const role of ['USER', 'ADMIN', 'SUPERADMIN'] as TestRole[]) {
            expect((await listByCase(caseId, role)).status).toBe(200);
        }
        expect((await listByCase(caseId, 'ANALYTICS')).status).toBe(403);
    });

    it('acepta paginacion y un caseId que no es UUID responde 400', async () => {
        const { notificationId, caseId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        await create({ notificationId, historyName: 'Tres' });

        const page = await listByCase(caseId, 'USER', '?limit=1&offset=1');
        expect(page.body.data.count).toBe(3);
        expect(page.body.data.rows).toHaveLength(1);
        expect(page.body.data.rows[0].medicalHistoryId).toBe(second.body.data.medicalHistoryId);

        expect((await listByCase('no-es-uuid')).status).toBe(400);
    });

    it('la ruta /case/:caseId alcanza el 006 y no el 003', async () => {
        const { caseId } = await notifyNewCase();
        const r = await listByCase(caseId);
        expect(r.status).toBe(200);
        // The 003 would have answered a single record, not { count, rows }
        expect(r.body.data.count).toBeDefined();
        expect(r.body.data.medicalHistoryId).toBeUndefined();
    });

    });

    describe('ESAVI-MEDHIST-004 - update, and the differential block of SPEC F12', () => {

    it('22 — un PUT con el body identico a lo guardado no escribe nada', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', notes: 'desde la infancia' });
        const id = created.body.data.medicalHistoryId;

        const before = await snapshot(id);
        const r = await update(id, { historyName: 'Asma', notes: 'desde la infancia' });
        expect(r.status).toBe(200);
        expect(await snapshot(id)).toEqual(before);
    });

    // 23 — resending the whole GET response writes nothing, divergent historyRaw included
    it('23 — reenviar integra la respuesta del GET no escribe nada (fila sin termino)', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', notes: 'x' });
        await expectPutOfGetResponseWritesNothing({
            path: basePath,
            id: created.body.data.medicalHistoryId,
            model: NotificationMedicalHistory,
            role: 'USER'
        });
    });

    it('23 — reenviar el GET no escribe nada con historyRaw divergente del nombre del maestro', async () => {
        const code = `st11-${ suffix }-a`;
        const first = await notifyNewCase();
        await create({ notificationId: first.notificationId, historyName: 'Nombre canonico', historyCode: code });

        const second = await notifyNewCase();
        const created = await create({
            notificationId: second.notificationId,
            historyName: 'Lo que escribio el notificador',
            historyCode: code
        });
        expect(created.body.data.historyRaw).toBe('Lo que escribio el notificador');
        expect(created.body.data.diagnosticTerm.name).toBe('Nombre canonico');

        await expectPutOfGetResponseWritesNothing({
            path: basePath,
            id: created.body.data.medicalHistoryId,
            model: NotificationMedicalHistory,
            role: 'USER'
        });

        // and the divergence survived
        const after = await getById(created.body.data.medicalHistoryId);
        expect(after.body.data.historyRaw).toBe('Lo que escribio el notificador');
    });

    // 24 — a PUT changing one field writes that field and nothing else
    it('24 — un PUT que cambia un solo campo escribe ese campo y appDetails crece en una entrada', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', notes: 'vieja' });
        const id = created.body.data.medicalHistoryId;
        const before = await snapshot(id);

        const r = await update(id, { notes: 'nueva' });
        expect(r.status).toBe(200);
        expect(r.body.data.notes).toBe('nueva');
        expect(r.body.data.historyRaw).toBe('Asma');

        const after = await snapshot(id);
        expect(after.appDetails).toBe(before.appDetails + 1);
        expect(after.updatedAt).not.toEqual(before.updatedAt);

        const details = r.body.data.appDetails;
        expect(details[details.length - 1].method).toBe('ESAVI-MEDHIST-004');
        expect(details[0].method).toBe('ESAVI-MEDHIST-001');
    });

    // 25 — the write is fired by the change of value, not by the presence of the key
    it('25 — un historyCode igual al guardado no consulta ni escribe diagnosticTerm', async () => {
        const { notificationId } = await notifyNewCase();
        const code = `st11-${ suffix }-b`;
        const created = await create({ notificationId, historyName: 'Asma bronquial', historyCode: code });
        const id = created.body.data.medicalHistoryId;

        const termsBefore = await DiagnosticTerm.count();
        const before = await snapshot(id);

        const r = await update(id, { historyCode: code });
        expect(r.status).toBe(200);
        expect(await DiagnosticTerm.count()).toBe(termsBefore);
        expect(await snapshot(id)).toEqual(before);
    });

    it('25 — un historyCode distinto si re-dispara la resolucion', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', historyCode: `st11-${ suffix }-c` });
        const id = created.body.data.medicalHistoryId;
        const termsBefore = await DiagnosticTerm.count();
        const before = await snapshot(id);

        const r = await update(id, { historyCode: `st11-${ suffix }-d` });
        expect(r.status).toBe(200);
        expect(await DiagnosticTerm.count()).toBe(termsBefore + 1);
        expect(r.body.data.diagnosticTermId).not.toBe(created.body.data.diagnosticTermId);
        const after = await snapshot(id);
        expect(after.updatedAt).not.toEqual(before.updatedAt);
        expect(after.appDetails).toBe(before.appDetails + 1);
    });

    // 26 — immutable fields are ignored in silence
    it('26 — notificationId ajeno y sortOrder: 200, no 400, y ninguno cambia en la base', async () => {
        const { notificationId } = await notifyNewCase();
        const other = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        const before = await snapshot(id);

        const r = await update(id, { notificationId: other.notificationId, sortOrder: 99 });
        expect(r.status).toBe(200);

        const after = await snapshot(id);
        expect(after.notificationId).toBe(notificationId);
        expect(after.sortOrder).toBe(before.sortOrder);
        expect(after).toEqual(before);
    });

    // 27 — notes is nullable, historyName is not
    it('27 — notes: null lo borra y cuenta como diferencia; notes ausente lo deja como estaba', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', notes: 'algo' });
        const id = created.body.data.medicalHistoryId;

        const cleared = await update(id, { notes: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.data.notes).toBeNull();

        const before = await snapshot(id);
        const absent = await update(id, { historyName: 'Asma' });
        expect(absent.status).toBe(200);
        expect(absent.body.data.notes).toBeNull();
        expect(await snapshot(id)).toEqual(before);
    });

    it('27 — historyName: null es 400 del validador y no llega al servicio', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        const before = await snapshot(id);

        const r = await update(id, { historyName: null });
        expect(r.status).toBe(400);
        expect(await snapshot(id)).toEqual(before);
    });

    // 28 — an empty diff is a 200 with the row, not a 304 or a 204
    it('28 — con el diff vacio la respuesta es 200 con la fila tal cual', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        const r = await update(id, {});
        expect(r.status).toBe(200);
        expect(r.body.ok).toBe(true);
        expect(r.body.data.medicalHistoryId).toBe(id);
        expect(r.body.data.historyRaw).toBe('Asma');
    });

    // 29 — the duplicate guard on the resulting term, excluding the row itself
    it('29 — resolver a un termino que ya tiene otro antecedente activo: 409', async () => {
        const { notificationId } = await notifyNewCase();
        const codeA = `st11-${ suffix }-e`;
        const codeB = `st11-${ suffix }-f`;
        await create({ notificationId, historyName: 'Primera', historyCode: codeA });
        const second = await create({ notificationId, historyName: 'Segunda', historyCode: codeB });
        const id = second.body.data.medicalHistoryId;

        const r = await update(id, { historyCode: codeA, historyName: 'Primera' });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('MEDHIST_004_ALREADY_EXISTS');

        // the row itself is excluded from the check: resending its own term is a 200
        const own = await update(id, { historyCode: codeB, historyName: 'Segunda' });
        expect(own.status).toBe(200);
    });

    // 30 — no PUT ever writes in notification
    it('30 — ningun PUT escribe en notification', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', notes: 'a' });
        const id = created.body.data.medicalHistoryId;

        const before = await Notification.findByPk(notificationId);
        const beforeUpdatedAt = before!.get('updatedAt' as never);
        const beforeFlag = before!.get('hasRelevantMedicalHistory' as never);

        await update(id, { notes: 'b' });
        await update(id, { historyName: 'Otra cosa' });
        await update(id, { historyCode: `st11-${ suffix }-g` });

        const after = await Notification.findByPk(notificationId);
        expect(after!.get('updatedAt' as never)).toEqual(beforeUpdatedAt);
        expect(after!.get('hasRelevantMedicalHistory' as never)).toEqual(beforeFlag);
    });

    // Existence and inherited visibility
    it('id inexistente: 404 MEDHIST_004_NOT_FOUND', async () => {
        const r = await update(unknownUuid, { notes: 'x' });
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_004_NOT_FOUND');
    });

    it('la visibilidad heredada se aplica: 404 USER y ADMIN, 200 SUPERADMIN', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

        expect((await update(id, { notes: 'x' }, 'USER')).status).toBe(404);
        expect((await update(id, { notes: 'x' }, 'ADMIN')).status).toBe(404);
        expect((await update(id, { notes: 'x' }, 'SUPERADMIN')).status).toBe(200);
    });

    it('el rol minimo del 004 es USER — la desviacion declarada de la matriz', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        expect((await update(id, { notes: 'desde USER' }, 'USER')).status).toBe(200);
        expect((await update(id, { notes: 'x' }, 'ANALYTICS')).status).toBe(403);
    });

    it('cambiar historyName sobre una fila con termino re-resuelve y actualiza historyRaw', async () => {
        const { notificationId } = await notifyNewCase();
        const code = `st11-${ suffix }-h`;
        const created = await create({ notificationId, historyName: 'Canonico dos', historyCode: code });
        const id = created.body.data.medicalHistoryId;
        expect(created.body.data.historyRaw).toBeNull();

        const r = await update(id, { historyName: 'Texto divergente' });
        expect(r.status).toBe(200);
        expect(r.body.data.historyRaw).toBe('Texto divergente');
        expect(r.body.data.diagnosticTermId).toBe(created.body.data.diagnosticTermId);
        expect(r.body.data.diagnosticTerm.name).toBe('Canonico dos');
    });

    });

    describe('ESAVI-MEDHIST-005A - deactivate', () => {

    it('sella isActive: false y deletedAt, y appDetails crece con ESAVI-MEDHIST-005A', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        const r = await remove(id);
        expect(r.status).toBe(200);

        const row = await NotificationMedicalHistory.findByPk(id);
        expect(row!.getDataValue('isActive')).toBe(false);
        expect(row!.getDataValue('deletedAt')).not.toBeNull();

        const details = row!.getDataValue('appDetails') as { method: string }[];
        expect(details).toHaveLength(2);
        expect(details[1].method).toBe('ESAVI-MEDHIST-005A');
    });

    it('repetir el 005A responde 409 MEDHIST_005A_ALREADY_INACTIVE', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        expect((await remove(id)).status).toBe(200);
        const again = await remove(id);
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('MEDHIST_005A_ALREADY_INACTIVE');
    });

    it('no comprueba el estado de la notificacion: retirar de una inactiva devuelve 200', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

        const r = await remove(id);
        expect(r.status).toBe(200);
        const row = await NotificationMedicalHistory.findByPk(id);
        expect(row!.getDataValue('isActive')).toBe(false);
    });

    it('hasRelevantMedicalHistory no cambia aunque el retirado sea el ultimo', async () => {
        const { notificationId } = await notifyNewCase();
        await Notification.update(
            { hasRelevantMedicalHistory: 'YES' } as never,
            { where: { notificationId } }
        );
        const created = await create({ notificationId, historyName: 'Unica' });

        const before = await Notification.findByPk(notificationId);
        const beforeFlag = before!.get('hasRelevantMedicalHistory' as never);
        const beforeUpdatedAt = before!.get('updatedAt' as never);

        expect((await remove(created.body.data.medicalHistoryId)).status).toBe(200);

        const after = await Notification.findByPk(notificationId);
        expect(after!.get('hasRelevantMedicalHistory' as never)).toEqual(beforeFlag);
        expect(after!.get('updatedAt' as never)).toEqual(beforeUpdatedAt);
        // and no live antecedent is left
        const listed = await request(app).get(`${ basePath }/notification/${ notificationId }`).set(authHeader('USER'));
        expect(listed.body.data.count).toBe(0);
    });

    it('tras el 005A un alta nueva puede recibir el sortOrder liberado', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        expect(second.body.data.sortOrder).toBe(2);

        expect((await remove(second.body.data.medicalHistoryId)).status).toBe(200);

        const third = await create({ notificationId, historyName: 'Tres' });
        expect(third.status).toBe(201);
        expect(third.body.data.sortOrder).toBe(2);
    });

    it('id inexistente: 404 MEDHIST_005A_NOT_FOUND', async () => {
        const r = await remove(unknownUuid);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_005A_NOT_FOUND');
    });

    it('el rol minimo es ADMIN: un USER recibe 403', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        expect((await remove(id, 'USER')).status).toBe(403);
        expect((await remove(id, 'ADMIN')).status).toBe(200);
    });

    it('la fila retirada desaparece del 002A y del 006 pero sigue en el 002B', async () => {
        const { notificationId, caseId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        await remove(created.body.data.medicalHistoryId);

        const active = await request(app).get(`${ basePath }/notification/${ notificationId }`).set(authHeader('USER'));
        expect(active.body.data.count).toBe(0);

        const byCase = await request(app).get(`${ basePath }/case/${ caseId }`).set(authHeader('USER'));
        expect(byCase.body.data.count).toBe(0);

        const all = await request(app).get(`${ basePath }/admin/notification/${ notificationId }`).set(authHeader('ADMIN'));
        expect(all.body.data.count).toBe(1);
        expect(all.body.data.rows[0].isActive).toBe(false);
    });

    });

    describe('ESAVI-MEDHIST-005B - reactivate, and the sortOrder collision', () => {

    it('33 — escenario de colision de sortOrder, entero: el reactivado queda en 3', async () => {
        const { notificationId } = await notifyNewCase();
        const first = await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        expect(first.body.data.sortOrder).toBe(1);
        expect(second.body.data.sortOrder).toBe(2);

        // retire the 2 — the number leaves the partial index and the MAX
        expect((await remove(second.body.data.medicalHistoryId)).status).toBe(200);

        // a new create legitimately takes MAX(1) + 1 = 2, colliding with the retired one
        const third = await create({ notificationId, historyName: 'Tres' });
        expect(third.body.data.sortOrder).toBe(2);

        // reactivating the retired row must answer 200, not a 500 from the unique index
        const reactivated = await activate(second.body.data.medicalHistoryId);
        expect(reactivated.status).toBe(200);
        expect(await sortOrderOf(second.body.data.medicalHistoryId)).toBe(3);

        // no two of the three live rows share a number
        const all = await request(app).get(`${ basePath }/notification/${ notificationId }`).set(authHeader('USER'));
        expect(all.body.data.count).toBe(3);
        const orders = all.body.data.rows.map((r: { sortOrder: number }) => r.sortOrder);
        expect(orders).toEqual([1, 2, 3]);
        expect(new Set(orders).size).toBe(3);
        // the reactivated one reappears at the end of the list
        expect(all.body.data.rows[2].medicalHistoryId).toBe(second.body.data.medicalHistoryId);
    });

    // 34 — without collision the original number is kept
    it('34 — sin colision el 005B conserva el sortOrder original', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        const id = second.body.data.medicalHistoryId;

        await remove(id);
        const reactivated = await activate(id);
        expect(reactivated.status).toBe(200);
        expect(await sortOrderOf(id)).toBe(2);
    });

    it('34 — reactivar una fila ya activa: 409 MEDHIST_005B_ALREADY_ACTIVE', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const r = await activate(created.body.data.medicalHistoryId);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('MEDHIST_005B_ALREADY_ACTIVE');
    });

    it('34 — el rol minimo es SUPERADMIN: un ADMIN recibe 403', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);

        expect((await activate(id, 'ADMIN')).status).toBe(403);
        expect((await activate(id, 'USER')).status).toBe(403);
        expect((await activate(id, 'SUPERADMIN')).status).toBe(200);
    });

    // 35 — the 005B does not revalidate the duplicate guard nor the parent state
    it('35 — la reactivacion no revalida la guarda de duplicado', async () => {
        const { notificationId } = await notifyNewCase();
        const code = `st13-${ suffix }-a`;
        const first = await create({ notificationId, historyName: 'Repetido', historyCode: code });
        const termId = first.body.data.diagnosticTermId;

        await remove(first.body.data.medicalHistoryId);
        // with the first one retired the same term can be loaded again
        const second = await create({ notificationId, historyName: 'Repetido', historyCode: code });
        expect(second.status).toBe(201);
        expect(second.body.data.diagnosticTermId).toBe(termId);

        // reactivating the first one leaves two live rows with the same term — assumed consequence
        const reactivated = await activate(first.body.data.medicalHistoryId);
        expect(reactivated.status).toBe(200);

        const live = await NotificationMedicalHistory.count({
            where: { notificationId, diagnosticTermId: termId, isActive: true }
        });
        expect(live).toBe(2);
    });

    it('35 — la reactivacion no revalida el estado del padre', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);
        await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

        const r = await activate(id);
        expect(r.status).toBe(200);
        const row = await NotificationMedicalHistory.findByPk(id);
        expect(row!.getDataValue('isActive')).toBe(true);
        expect(row!.getDataValue('deletedAt')).toBeNull();
    });

    it('limpia deletedAt y appDetails crece con ESAVI-MEDHIST-005B', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);
        await activate(id);

        const row = await NotificationMedicalHistory.findByPk(id);
        expect(row!.getDataValue('isActive')).toBe(true);
        expect(row!.getDataValue('deletedAt')).toBeNull();
        const details = row!.getDataValue('appDetails') as { method: string }[];
        expect(details.map(d => d.method)).toEqual([
            'ESAVI-MEDHIST-001', 'ESAVI-MEDHIST-005A', 'ESAVI-MEDHIST-005B'
        ]);
    });

    it('id inexistente: 404 MEDHIST_005B_NOT_FOUND', async () => {
        const r = await activate(unknownUuid);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_005B_NOT_FOUND');
    });

    it('la ruta /activate/:id alcanza el 005B y no el 003', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);
        const r = await activate(id);
        expect(r.status).toBe(200);
        expect(r.body.message).not.toContain('obtenid');
    });

    });

    describe('ESAVI-MEDHIST-005C - physical delete', () => {

    it('purgar un antecedente activo: 409 MEDHIST_005C_STILL_ACTIVE', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        const r = await purge(id);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('MEDHIST_005C_STILL_ACTIVE');
        expect(await NotificationMedicalHistory.findByPk(id)).not.toBeNull();
    });

    it('purgar uno retirado lo destruye y un 003 posterior responde 404', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        await remove(id);
        const r = await purge(id);
        expect(r.status).toBe(200);
        // CONVENTIONS.md §10: 005A, 005B and 005C answer { ok, message } with no data at all
        expect(r.body.data).toBeUndefined();
        expect(Object.keys(r.body).sort()).toEqual([ 'message', 'ok' ]);

        expect(await NotificationMedicalHistory.findByPk(id)).toBeNull();
        const after = await getById(id);
        expect(after.status).toBe(404);
        expect(after.body.code).toBe('MEDHIST_003_NOT_FOUND');
    });

    it('el diagnosticTerm que citaba sigue existiendo', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma', historyCode: `st14-${ suffix }` });
        const id = created.body.data.medicalHistoryId;
        const termId = created.body.data.diagnosticTermId;
        expect(termId).not.toBeNull();

        await remove(id);
        expect((await purge(id)).status).toBe(200);

        expect(await DiagnosticTerm.findByPk(termId)).not.toBeNull();
    });

    it('no comprueba el estado de la notificacion', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);
        await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

        expect((await purge(id)).status).toBe(200);
        expect(await NotificationMedicalHistory.findByPk(id)).toBeNull();
    });

    it('el rol minimo es SUPERADMIN: ADMIN y USER reciben 403', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;
        await remove(id);

        expect((await purge(id, 'USER')).status).toBe(403);
        expect((await purge(id, 'ADMIN')).status).toBe(403);
        expect((await purge(id, 'SUPERADMIN')).status).toBe(200);
    });

    it('id inexistente: 404 MEDHIST_005C_NOT_FOUND', async () => {
        const r = await purge(unknownUuid);
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_005C_NOT_FOUND');
    });

    it('la ruta /purge/:id alcanza el 005C y no el 005A', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        const id = created.body.data.medicalHistoryId;

        // still active: the 005C answers 409, the 005A would have answered 200
        const r = await purge(id);
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('MEDHIST_005C_STILL_ACTIVE');
        expect((await NotificationMedicalHistory.findByPk(id))!.getDataValue('isActive')).toBe(true);
    });

    it('la purga libera el sortOrder para un alta posterior', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Uno' });
        const second = await create({ notificationId, historyName: 'Dos' });
        const id = second.body.data.medicalHistoryId;

        await remove(id);
        expect((await purge(id)).status).toBe(200);

        const third = await create({ notificationId, historyName: 'Tres' });
        expect(third.status).toBe(201);
        expect(third.body.data.sortOrder).toBe(2);
        const listed = await request(app).get(`${ basePath }/admin/notification/${ notificationId }`).set(authHeader('ADMIN'));
        expect(listed.body.data.count).toBe(2);
    });

    });

    describe('ESAVI-NOTIFCN-005C - the dump this spec adds to a foreign service', () => {

    it('con tres antecedentes, uno retirado, escribe UNA linea warn con el 3 y los tres ids', async () => {
        const { notificationId } = await notifyNewCase();
        const a = await create({ notificationId, historyName: 'Asma' });
        const b = await create({ notificationId, historyName: 'Bronquitis' });
        const c = await create({ notificationId, historyName: 'Cardiopatia' });
        const ids = [a, b, c].map(r => r.body.data.medicalHistoryId);

        // one of the three retired: paranoid: false must still count it
        await request(app).delete(`${ basePath }/${ ids[1] }`).set(authHeader('ADMIN'));
        await deactivateNotification(notificationId);

        const { lines, restore } = captureLogs();
        const r = await purgeNotification(notificationId);
        restore();

        expect(r.status).toBe(200);

        const dumped = lines.filter(l => l.message.includes('notificationMedicalHistory row(s) dragged'));
        expect(dumped).toHaveLength(1);
        expect(dumped[0].level).toBe('warn');
        expect(dumped[0].message).toContain('ESAVI-NOTIFCN-005C: 3 notificationMedicalHistory row(s) dragged');
        for (const id of ids) {
            expect(dumped[0].message).toContain(id);
        }

        // the cascade really destroyed them
        expect(await NotificationMedicalHistory.count({ where: { notificationId }, paranoid: false })).toBe(0);
    });

    it('con cero antecedentes no escribe ninguna linea', async () => {
        const { notificationId } = await notifyNewCase();
        await deactivateNotification(notificationId);

        const { lines, restore } = captureLogs();
        const r = await purgeNotification(notificationId);
        restore();

        expect(r.status).toBe(200);
        expect(lines.filter(l => l.message.includes('notificationMedicalHistory row(s) dragged'))).toHaveLength(0);
    });

    it('la purga no se bloquea por tener antecedentes', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Asma' });
        await create({ notificationId, historyName: 'Diabetes' });
        await deactivateNotification(notificationId);

        const r = await purgeNotification(notificationId);
        expect(r.status).toBe(200);
        expect(await NotificationMedicalHistory.count({ where: { notificationId }, paranoid: false })).toBe(0);
    });

    it('un fallo dentro del volcado no aborta la purga: escribe su linea error y continua', async () => {
        const { notificationId } = await notifyNewCase();
        await create({ notificationId, historyName: 'Asma' });
        await deactivateNotification(notificationId);

        const findAll = jest.spyOn(NotificationMedicalHistory, 'findAll')
            .mockRejectedValueOnce(new Error('boom'));
        const { lines, restore } = captureLogs();
        const r = await purgeNotification(notificationId);
        restore();
        findAll.mockRestore();

        expect(r.status).toBe(200);
        const failure = lines.filter(l => l.message.includes('Failed to dump the dragged notificationMedicalHistories'));
        expect(failure).toHaveLength(1);
        expect(failure[0].level).toBe('error');
        // the purge went through all the same
        expect(await NotificationMedicalHistory.count({ where: { notificationId }, paranoid: false })).toBe(0);
    });

    it('el 005A de la notificacion NO sella los antecedentes', async () => {
        const { notificationId } = await notifyNewCase();
        const created = await create({ notificationId, historyName: 'Asma' });
        await deactivateNotification(notificationId);

        const row = await NotificationMedicalHistory.findByPk(created.body.data.medicalHistoryId);
        expect(row!.getDataValue('isActive')).toBe(true);
        expect(row!.getDataValue('deletedAt')).toBeNull();
    });

    });

    describe('Routing - the nine routes and their order', () => {

    it('las nueve rutas existen y cada una alcanza su propia operacion', async () => {
        const { notificationId, caseId } = await notifyNewCase();

        // 001
        const created = await request(app).post(basePath).set(authHeader('USER'))
            .send({ notificationId, historyName: 'Asma' });
        expect(created.status).toBe(201);
        const id = created.body.data.medicalHistoryId;

        // 006 — by case, returns { count, rows }, never a single record
        const byCase = await request(app).get(`${ basePath }/case/${ caseId }`).set(authHeader('USER'));
        expect(byCase.status).toBe(200);
        expect(byCase.body.data.count).toBe(1);
        expect(byCase.body.data.medicalHistoryId).toBeUndefined();

        // 002B — admin, before /notification/:id
        const admin = await request(app).get(`${ basePath }/admin/notification/${ notificationId }`).set(authHeader('ADMIN'));
        expect(admin.status).toBe(200);
        expect(await request(app).get(`${ basePath }/admin/notification/${ notificationId }`).set(authHeader('USER'))
            .then(r => r.status)).toBe(403);

        // 002A — user
        const active = await request(app).get(`${ basePath }/notification/${ notificationId }`).set(authHeader('USER'));
        expect(active.status).toBe(200);
        expect(active.body.data.count).toBe(1);

        // 003 — single record, not { count, rows }
        const byId = await request(app).get(`${ basePath }/${ id }`).set(authHeader('USER'));
        expect(byId.status).toBe(200);
        expect(byId.body.data.medicalHistoryId).toBe(id);
        expect(byId.body.data.count).toBeUndefined();

        // 004 — USER, not ADMIN
        const updated = await request(app).put(`${ basePath }/${ id }`).set(authHeader('USER')).send({ notes: 'x' });
        expect(updated.status).toBe(200);

        // 005C over an active row reaches the purge guard, not the 005A
        const earlyPurge = await request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader('SUPERADMIN'));
        expect(earlyPurge.status).toBe(409);
        expect(earlyPurge.body.code).toBe('MEDHIST_005C_STILL_ACTIVE');

        // 005A — ADMIN
        expect((await request(app).delete(`${ basePath }/${ id }`).set(authHeader('ADMIN'))).status).toBe(200);

        // 005B — SUPERADMIN
        expect((await request(app).patch(`${ basePath }/activate/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(200);

        // 005A again, then 005C for real
        await request(app).delete(`${ basePath }/${ id }`).set(authHeader('ADMIN'));
        expect((await request(app).delete(`${ basePath }/purge/${ id }`).set(authHeader('SUPERADMIN'))).status).toBe(200);
    });

    it('ninguna literal cae en el validador de UUID del :id', async () => {
        const { notificationId, caseId } = await notifyNewCase();
        // Each literal segment resolves to its own route and never answers the 400 of the :id validator
        const probes: [string, string, TestRole, number][] = [
            ['get', `${ basePath }/case/${ caseId }`, 'USER', 200],
            ['get', `${ basePath }/admin/notification/${ notificationId }`, 'ADMIN', 200],
            ['get', `${ basePath }/notification/${ notificationId }`, 'USER', 200]
        ];
        for (const [method, path, role, expected] of probes) {
            const r = await (request(app) as never as Record<string, (p: string) => request.Test>)[method](path).set(authHeader(role));
            expect(r.status).toBe(expected);
        }
        // and a real non-UUID :id does answer 400
        expect((await request(app).get(`${ basePath }/no-es-uuid`).set(authHeader('USER'))).status).toBe(400);
    });

    it('la ruta base esta montada en /api/notification-medical-histories', async () => {
        const r = await request(app).get(`${ basePath }/00000000-0000-4000-8000-000000000000`).set(authHeader('USER'));
        // 404 of the entity, not a 404 of Express for an unmounted path
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('MEDHIST_003_NOT_FOUND');
    });

    it('sin token toda ruta responde 401', async () => {
        const { notificationId } = await notifyNewCase();
        expect((await request(app).get(`${ basePath }/notification/${ notificationId }`)).status).toBe(401);
        expect((await request(app).post(basePath).send({ notificationId, historyName: 'x' })).status).toBe(401);
    });

    });
});
