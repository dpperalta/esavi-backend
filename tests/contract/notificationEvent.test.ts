import request from 'supertest';
import { DiagnosticTerm, EsaviCase, HealthFacility, Notification, NotificationEvent, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine notificationEvent operations of SPEC F16. It walks the
 * entity end to end — create, read by id, list by notification, admin list, list by
 * case, update, deactivate, reactivate, purge — and covers what cannot be checked by
 * hand reliably.
 *
 * This is the first satellite of notification that is one to many, the first one with
 * an isActive column of its own, and the first one with order among siblings, so it
 * has to prove three things its two predecessors never faced.
 *
 * The sortOrder collision is the one that motivated the spec: the partial unique index
 * is conditioned by deletedAt, so a 005A frees the number, a later create reuses it,
 * and reactivating the old row would blow the index up. The suite runs those four
 * movements literally and expects the reactivated event at the end of the list.
 *
 * The resolution against the clinical master is the second: LOCAL coins the term,
 * an external source only looks it up, and in both cases the master rules over
 * esaviName while the notifier's words survive in esaviRawName. The third is the
 * differential update, where the resolution must fire on the real change of the code
 * and never on the presence of the key — otherwise every PUT resending a GET would
 * write in the clinical catalog.
 */
describe('notificationEvent contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // A term of an external source, which can be referenced but never coined from a form
    let meddraCode: string;

    const createCaseFixture = async (): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Event ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`EV${ caseCounter }${ suffix }`),
            healthSystemCode: `EV${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `EV${ caseCounter }${ suffix }`,
            name: `Event ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `EV-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification over a brand new case. Unlike its two one to one siblings this entity
    // does not care about notificationType, so the type is fixed and never a fixture knob
    const notifyNewCase = async (): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createEvent = ( payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).post('/api/notification-events').set(authHeader(role)).send(payload);

    const getEvent = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-events/${ id }`).set(authHeader(role));

    const listByNotification = ( notificationId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`/api/notification-events/notification/${ notificationId }${ query }`).set(authHeader(role));

    const listAllByNotification = ( notificationId: string, role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notification-events/admin/notification/${ notificationId }`).set(authHeader(role));

    const listByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-events/case/${ caseId }`).set(authHeader(role));

    const updateEvent = ( id: string, payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).put(`/api/notification-events/${ id }`).set(authHeader(role)).send(payload);

    const deleteEvent = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notification-events/${ id }`).set(authHeader(role));

    const activateEvent = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notification-events/activate/${ id }`).set(authHeader(role));

    const purgeEvent = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notification-events/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new event over its own notification, ready to be read or updated
    const newEvent = async ( payload: Record<string, unknown> = {} ): Promise<{ eventId: string, notificationId: string, caseId: string }> => {
        const { notificationId, caseId } = await notifyNewCase();
        const created = await createEvent({ notificationId, esaviName: 'Fiebre', ...payload });
        return { eventId: created.body.data.eventId, notificationId, caseId };
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NotificationEvent.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const sortOrders = async ( notificationId: string ): Promise<number[]> => {
        const rows = await NotificationEvent.findAll({
            where: { notificationId },
            order: [[ 'sortOrder', 'ASC' ]]
        });
        return rows.map(row => row.getDataValue('sortOrder') as number);
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        // The only fixture of the suite: a MEDDRA term, which the API can reference but can
        // never create. There is no catalogType precondition — unlike F14, this entity depends
        // on no seeded catalog
        meddraCode = `MEDDRA_${ suffix }`;
        await DiagnosticTerm.create({ source: 'MEDDRA', code: meddraCode, name: `Pyrexia ${ suffix }` });
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the walkthrough', () => {

        it('goes create -> get -> list -> admin list -> by case -> update -> deactivate -> reactivate -> purge', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            // Create
            const created = await createEvent({ notificationId, esaviName: 'Fiebre alta' });
            expect(created.status).toBe(201);
            expect(created.body.data.sortOrder).toBe(1);
            const eventId = created.body.data.eventId;

            // Get by id
            expect(( await getEvent(eventId) ).status).toBe(200);

            // List by notification, admin list and list by case
            expect(( await listByNotification(notificationId) ).body.data.count).toBe(1);
            expect(( await listAllByNotification(notificationId) ).body.data.count).toBe(1);
            const byCase = await listByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.rows[0].notificationId).toBe(notificationId);

            // Update
            const updated = await updateEvent(eventId, { notes: 'a note' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.notes).toBe('a note');

            // Purging before the retirement is refused: two deliberate steps are the safety net
            expect(( await purgeEvent(eventId) ).status).toBe(409);

            // Deactivate and reactivate
            expect(( await deleteEvent(eventId) ).status).toBe(200);
            expect(( await activateEvent(eventId) ).status).toBe(200);

            // Purge
            expect(( await deleteEvent(eventId) ).status).toBe(200);
            expect(( await purgeEvent(eventId) ).status).toBe(200);
            expect(await NotificationEvent.findByPk(eventId)).toBeNull();
        });

    });

    describe('ESAVI-NOTIFEVT-001 — create', () => {

        it('coins the term when the code is unknown and the source is implicitly LOCAL', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createEvent({
                notificationId,
                esaviName: 'Fiebre alta',
                esaviCode: `  fiebre alta ${ suffix }  `
            });

            expect(response.status).toBe(201);
            const expectedCode = `FIEBRE_ALTA_${ suffix }`;
            expect(response.body.data.esaviCode).toBe(expectedCode);

            const term = await DiagnosticTerm.findOne({ where: { source: 'LOCAL', code: expectedCode } });
            expect(term).not.toBeNull();
            expect(( term!.getDataValue('metadata') as { autoCreated?: boolean } ).autoCreated).toBe(true);
            expect(( term!.getDataValue('metadata') as { createdFrom?: string } ).createdFrom).toBe('ESAVI-NOTIFEVT-001');
        });

        it('lets the master rule over esaviName and keeps the divergence in esaviRawName', async () => {
            const { notificationId } = await notifyNewCase();
            const code = `CEFALEA_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Cefalea' });

            const response = await createEvent({ notificationId, esaviName: 'dolor de cabeza', esaviCode: code });

            expect(response.status).toBe(201);
            expect(response.body.data.esaviName).toBe('Cefalea');
            expect(response.body.data.esaviRawName).toBe('dolor de cabeza');
        });

        it('leaves esaviRawName null when the name matches the master', async () => {
            const { notificationId } = await notifyNewCase();
            const code = `NAUSEA_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Nausea' });

            const response = await createEvent({ notificationId, esaviName: 'Nausea', esaviCode: code });

            expect(response.status).toBe(201);
            expect(response.body.data.esaviRawName).toBeNull();
        });

        it('resolves an external source without creating anything', async () => {
            const { notificationId } = await notifyNewCase();
            const before = await DiagnosticTerm.count();

            const response = await createEvent({
                notificationId,
                esaviName: 'fiebre',
                esaviCode: meddraCode,
                source: 'MEDDRA'
            });

            expect(response.status).toBe(201);
            expect(response.body.data.diagnosticTerm.source).toBe('MEDDRA');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

        it('answers 404 for an external source whose code does not exist, and creates nothing', async () => {
            const { notificationId } = await notifyNewCase();
            const before = await DiagnosticTerm.count();

            const response = await createEvent({
                notificationId,
                esaviName: 'fiebre',
                esaviCode: `MISSING_${ suffix }`,
                source: 'MEDDRA'
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFEVT_001_DIAGTERM_NOT_FOUND');
            expect(await DiagnosticTerm.count()).toBe(before);
        });

        it('leaves diagnosticTermId null when no code travels', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createEvent({ notificationId, esaviName: '  Dolor local  ' });

            expect(response.status).toBe(201);
            expect(response.body.data.diagnosticTermId).toBeNull();
            expect(response.body.data.diagnosticTerm).toBeNull();
            expect(response.body.data.esaviName).toBe('Dolor local');
        });

        it('assigns sortOrder 1, 2 and 3 to three consecutive events without the service sending it', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createEvent({ notificationId, esaviName: name });
            }

            expect(await sortOrders(notificationId)).toEqual([ 1, 2, 3 ]);
        });

        it('ignores a sortOrder sent in the body without answering 400', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createEvent({ notificationId, esaviName: 'Fiebre', sortOrder: 99 });

            expect(response.status).toBe(201);
            expect(response.body.data.sortOrder).toBe(1);
        });

        it('answers 404 over a notification that does not exist or is inactive', async () => {
            expect(( await createEvent({ notificationId: unknownUuid, esaviName: 'Fiebre' }) ).status).toBe(404);

            const { notificationId } = await notifyNewCase();
            await deactivateNotification(notificationId);
            const response = await createEvent({ notificationId, esaviName: 'Fiebre' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFEVT_001_NOTIFICATION_NOT_FOUND');
        });

        it('rejects the three incoherent combinations of the "other" event', async () => {
            const { notificationId } = await notifyNewCase();

            const noDescription = await createEvent({ notificationId, esaviName: 'Otro', isOtherEsavi: true });
            expect(noDescription.status).toBe(400);
            expect(noDescription.body.code).toBe('NOTIFEVT_001_OTHER_DESCRIPTION_REQUIRED');

            const withCode = await createEvent({
                notificationId, esaviName: 'Otro', isOtherEsavi: true,
                otherDescription: 'Erupcion estrellada', esaviCode: `X_${ suffix }`
            });
            expect(withCode.status).toBe(400);
            expect(withCode.body.code).toBe('NOTIFEVT_001_OTHER_ESAVI_CONFLICT');

            const strayDescription = await createEvent({
                notificationId, esaviName: 'Otro', otherDescription: 'Erupcion estrellada'
            });
            expect(strayDescription.status).toBe(400);
            expect(strayDescription.body.code).toBe('NOTIFEVT_001_OTHER_DESCRIPTION_NOT_ALLOWED');
        });

        it('accepts a well formed "other" event and keeps the split date and time', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createEvent({
                notificationId,
                esaviName: 'Reaccion no catalogada',
                isOtherEsavi: true,
                otherDescription: 'Erupcion con forma de estrella',
                startDate: '2026-08-01',
                startTime: '14:30'
            });

            expect(response.status).toBe(201);
            expect(response.body.data.startDate).toBe('2026-08-01');
            expect(response.body.data.startTime).toBe('14:30:00');
        });

        it('answers 403 for a USER', async () => {
            const { notificationId } = await notifyNewCase();

            expect(( await createEvent({ notificationId, esaviName: 'Fiebre' }, 'USER') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFEVT-002A / 002B — the two listings', () => {

        it('returns the events of its notification ordered by sortOrder', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createEvent({ notificationId, esaviName: name });
            }

            const response = await listByNotification(notificationId);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows.map(( row: { esaviName: string } ) => row.esaviName)).toEqual([ 'Uno', 'Dos', 'Tres' ]);
        });

        it('drops a retired event from 002A and keeps it in 002B', async () => {
            const { notificationId } = await notifyNewCase();
            const first = await createEvent({ notificationId, esaviName: 'Uno' });
            await createEvent({ notificationId, esaviName: 'Dos' });
            await deleteEvent(first.body.data.eventId);

            expect(( await listByNotification(notificationId) ).body.data.count).toBe(1);

            const admin = await listAllByNotification(notificationId);
            expect(admin.body.data.count).toBe(2);
            expect(admin.body.data.rows.some(( row: { isActive: boolean } ) => row.isActive === false)).toBe(true);
        });

        it('paginates without losing the total count', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createEvent({ notificationId, esaviName: name });
            }

            const response = await listByNotification(notificationId, 'USER', '?limit=1&offset=1');

            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows).toHaveLength(1);
            expect(response.body.data.rows[0].esaviName).toBe('Dos');
        });

        it('answers 404 over an inactive notification, and 200 for a SUPERADMIN', async () => {
            const { notificationId } = await notifyNewCase();
            await createEvent({ notificationId, esaviName: 'Uno' });
            await deactivateNotification(notificationId);

            const asUser = await listByNotification(notificationId);
            expect(asUser.status).toBe(404);
            expect(asUser.body.code).toBe('NOTIFEVT_002A_NOTIFICATION_NOT_FOUND');

            expect(( await listByNotification(notificationId, 'ADMIN') ).status).toBe(404);
            expect(( await listByNotification(notificationId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 403 for a USER on the admin listing', async () => {
            const { notificationId } = await notifyNewCase();

            expect(( await listAllByNotification(notificationId, 'USER') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFEVT-003 — get by id', () => {

        it('returns the row with its resolved term and without sysDetails or notification', async () => {
            const code = `TOS_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Tos' });
            const { eventId } = await newEvent({ esaviName: 'Tos', esaviCode: code });

            const response = await getEvent(eventId);

            expect(response.status).toBe(200);
            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.notification).toBeUndefined();
            expect(Object.keys(response.body.data.diagnosticTerm).sort()).toEqual(
                [ 'code', 'diagnosticTermId', 'isActive', 'name', 'source', 'termGroup' ]
            );
        });

        it('hides a retired event from everybody but a SUPERADMIN', async () => {
            const { eventId } = await newEvent();
            await deleteEvent(eventId);

            expect(( await getEvent(eventId) ).status).toBe(404);
            expect(( await getEvent(eventId, 'ADMIN') ).status).toBe(404);
            expect(( await getEvent(eventId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('hides an event whose notification is inactive from everybody but a SUPERADMIN', async () => {
            const { eventId, notificationId } = await newEvent();
            await deactivateNotification(notificationId);

            expect(( await getEvent(eventId) ).status).toBe(404);
            expect(( await getEvent(eventId, 'ADMIN') ).status).toBe(404);
            expect(( await getEvent(eventId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 400 of UUID and not 404 for a literal path captured as an id', async () => {
            const response = await getEvent('algo');

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFEVT-006 — the events of a case', () => {

        it('walks case -> notification -> events and returns the notificationId', async () => {
            const { notificationId, caseId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createEvent({ notificationId, esaviName: name });
            }

            const response = await listByCase(caseId);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows[0].notificationId).toBe(notificationId);
        });

        it('answers 404 for a case that does not exist', async () => {
            const response = await listByCase(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFEVT_006_CASE_NOT_FOUND');
        });

        it('tells the broken link of the chain apart when the case has no notification', async () => {
            const caseId = await createCaseFixture();

            const response = await listByCase(caseId);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFEVT_006_NOTIFICATION_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFEVT-004 — the differential update', () => {

        it('writes nothing when the whole GET response is sent back', async () => {
            const code = `MAREO_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Mareo' });
            // The divergence is the hard case: esaviName holds the master's word and
            // esaviRawName the notifier's, so a naive resend would clear the second one
            const { eventId } = await newEvent({ esaviName: 'me da vueltas la cabeza', esaviCode: code });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notification-events',
                id: eventId,
                model: NotificationEvent
            });

            const row = await NotificationEvent.findByPk(eventId);
            expect(row!.getDataValue('esaviRawName')).toBe('me da vueltas la cabeza');
        });

        it('writes nothing for an empty body', async () => {
            const { eventId } = await newEvent();
            const before = await NotificationEvent.findByPk(eventId);

            const response = await updateEvent(eventId, {});

            expect(response.status).toBe(200);
            expect(await auditMethods(eventId)).toEqual([ 'ESAVI-NOTIFEVT-001' ]);
            expect(( await NotificationEvent.findByPk(eventId) )!.getDataValue('updatedAt'))
                .toEqual(before!.getDataValue('updatedAt'));
        });

        it('adds one audit entry and bumps the version by one when a single field changes', async () => {
            const { eventId } = await newEvent();
            const versionBefore = ( ( await NotificationEvent.findByPk(eventId) )!
                .getDataValue('sysDetails') as { version?: number } ).version!;

            await updateEvent(eventId, { notes: 'una nota' });

            expect(await auditMethods(eventId)).toEqual([ 'ESAVI-NOTIFEVT-001', 'ESAVI-NOTIFEVT-004' ]);
            expect(( ( await NotificationEvent.findByPk(eventId) )!
                .getDataValue('sysDetails') as { version?: number } ).version).toBe(versionBefore + 1);
        });

        it('does not touch the clinical master when the stored code is resent', async () => {
            const code = `VOMITO_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Vomito' });
            const { eventId } = await newEvent({ esaviName: 'Vomito', esaviCode: code });
            const before = await DiagnosticTerm.count();

            const response = await updateEvent(eventId, { esaviCode: code });

            expect(response.status).toBe(200);
            expect(await DiagnosticTerm.count()).toBe(before);
            expect(await auditMethods(eventId)).toEqual([ 'ESAVI-NOTIFEVT-001' ]);
        });

        it('leaves the three derived fields identical when only notes changes', async () => {
            const code = `DIARREA_${ suffix }`;
            await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Diarrea' });
            const { eventId } = await newEvent({ esaviName: 'descomposicion', esaviCode: code });

            const response = await updateEvent(eventId, { notes: 'otra nota' });

            expect(response.body.data.esaviName).toBe('Diarrea');
            expect(response.body.data.esaviRawName).toBe('descomposicion');
            expect(response.body.data.diagnosticTermId).not.toBeNull();
        });

        it('coins the term and moves the three derived fields in a single audit entry', async () => {
            const { eventId } = await newEvent();

            const response = await updateEvent(eventId, {
                esaviCode: `escalofrios ${ suffix }`,
                esaviName: 'temblores'
            });

            expect(response.status).toBe(200);
            expect(response.body.data.esaviCode).toBe(`ESCALOFRIOS_${ suffix }`);
            expect(response.body.data.esaviName).toBe('temblores');
            expect(response.body.data.diagnosticTermId).not.toBeNull();
            expect(await auditMethods(eventId)).toEqual([ 'ESAVI-NOTIFEVT-001', 'ESAVI-NOTIFEVT-004' ]);
        });

        it('answers 404 for an external code that does not exist even though nothing else changes', async () => {
            const { eventId } = await newEvent();

            const response = await updateEvent(eventId, { esaviCode: `MISSING2_${ suffix }`, source: 'MEDDRA' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFEVT_004_DIAGTERM_NOT_FOUND');
            expect(await auditMethods(eventId)).toEqual([ 'ESAVI-NOTIFEVT-001' ]);
        });

        it('evaluates the "other" rule over the resulting state and not over the body', async () => {
            const { eventId } = await newEvent();

            const response = await updateEvent(eventId, { otherDescription: 'algo' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFEVT_004_OTHER_DESCRIPTION_NOT_ALLOWED');
        });

        it('ignores sortOrder and notificationId without answering 400', async () => {
            const { eventId, notificationId } = await newEvent();
            const other = await notifyNewCase();

            const response = await updateEvent(eventId, { sortOrder: 99, notificationId: other.notificationId });

            expect(response.status).toBe(200);
            expect(response.body.data.sortOrder).toBe(1);
            expect(response.body.data.notificationId).toBe(notificationId);
        });

        it('answers 403 for a USER', async () => {
            const { eventId } = await newEvent();

            expect(( await updateEvent(eventId, { notes: 'x' }, 'USER') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFEVT-005A / 005B — retire and bring back', () => {

        it('seals deletedAt on 005A and answers 409 the second time', async () => {
            const { eventId } = await newEvent();

            expect(( await deleteEvent(eventId) ).status).toBe(200);
            const row = await NotificationEvent.findByPk(eventId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();

            const repeated = await deleteEvent(eventId);
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('NOTIFEVT_005A_ALREADY_INACTIVE');
        });

        // The finding that motivated the spec, in its four literal movements
        it('moves the reactivated event to the end when its sortOrder was taken meanwhile', async () => {
            const { notificationId } = await notifyNewCase();
            const created = [];
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                created.push(( await createEvent({ notificationId, esaviName: name }) ).body.data.eventId);
            }

            await deleteEvent(created[2]);
            const fourth = await createEvent({ notificationId, esaviName: 'Cuatro' });
            expect(fourth.body.data.sortOrder).toBe(3);

            const reactivated = await activateEvent(created[2]);
            expect(reactivated.status).toBe(200);

            const row = await NotificationEvent.findByPk(created[2]);
            expect(row!.getDataValue('sortOrder')).toBe(4);
            expect(await sortOrders(notificationId)).toEqual([ 1, 2, 3, 4 ]);
        });

        it('does not move the sortOrder when the number is still free', async () => {
            const { eventId } = await newEvent();
            await deleteEvent(eventId);

            expect(( await activateEvent(eventId) ).status).toBe(200);
            expect(( await NotificationEvent.findByPk(eventId) )!.getDataValue('sortOrder')).toBe(1);
        });

        it('answers 409 when reactivating an event that is already active', async () => {
            const { eventId } = await newEvent();

            const response = await activateEvent(eventId);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFEVT_005B_ALREADY_ACTIVE');
        });

        it('records both operations in the audit trail with the code and only the code', async () => {
            const { eventId } = await newEvent();
            await deleteEvent(eventId);
            await activateEvent(eventId);

            expect(await auditMethods(eventId)).toEqual([
                'ESAVI-NOTIFEVT-001', 'ESAVI-NOTIFEVT-005A', 'ESAVI-NOTIFEVT-005B'
            ]);
        });

        it('answers 403 for an ADMIN on the activation', async () => {
            const { eventId } = await newEvent();
            await deleteEvent(eventId);

            expect(( await activateEvent(eventId, 'ADMIN') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFEVT-005C — physical delete', () => {

        it('refuses to purge an active event', async () => {
            const { eventId } = await newEvent();

            const response = await purgeEvent(eventId);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFEVT_005C_STILL_ACTIVE');
            expect(await NotificationEvent.findByPk(eventId)).not.toBeNull();
        });

        it('purges a retired event whose notification is still active', async () => {
            const { eventId, notificationId } = await newEvent();
            await deleteEvent(eventId);

            const response = await purgeEvent(eventId);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(await NotificationEvent.findByPk(eventId)).toBeNull();
            expect(( await Notification.findByPk(notificationId) )!.getDataValue('isActive')).toBe(true);
        });

        it('answers 404 the second time and 403 for an ADMIN', async () => {
            const { eventId } = await newEvent();
            await deleteEvent(eventId);

            expect(( await purgeEvent(eventId, 'ADMIN') ).status).toBe(403);
            expect(( await purgeEvent(eventId) ).status).toBe(200);

            const repeated = await purgeEvent(eventId);
            expect(repeated.status).toBe(404);
            expect(repeated.body.code).toBe('NOTIFEVT_005C_NOT_FOUND');
        });

        it('leaves the referenced term intact', async () => {
            const code = `ARDOR_${ suffix }`;
            const term = await DiagnosticTerm.create({ source: 'LOCAL', code, name: 'Ardor' });
            const { eventId } = await newEvent({ esaviName: 'Ardor', esaviCode: code });
            await deleteEvent(eventId);

            expect(( await purgeEvent(eventId) ).status).toBe(200);
            expect(await DiagnosticTerm.findByPk(term.getDataValue('diagnosticTermId'))).not.toBeNull();
        });

    });

    describe('the cascade of ESAVI-NOTIFCN-005C', () => {

        it('drags every event of the purged notification', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres', 'Cuatro' ] ) {
                await createEvent({ notificationId, esaviName: name });
            }
            await deactivateNotification(notificationId);

            const purged = await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await NotificationEvent.count({ where: { notificationId } })).toBe(0);
        });

    });

});
