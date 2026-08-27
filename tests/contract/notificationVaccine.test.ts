import request from 'supertest';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/database/connection';
import { EsaviCase, HealthFacility, NotificationVaccine, Patient, VaccineWhodrug } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine notificationVaccine operations of SPEC F22. It walks the
 * entity end to end — create, read by id, list by notification, admin list, list by
 * case, update, deactivate, reactivate, purge — and covers what cannot be checked by
 * hand reliably.
 *
 * This is the fifth satellite of notification and the third one to many, so it inherits
 * the sortOrder collision F16 faced and F21 reconfirmed: the partial unique index is
 * conditioned by deletedAt, so a 005A frees the number, a later create reuses it, and
 * reactivating the old row would blow the index up. The suite runs those four movements
 * literally and expects the reactivated vaccine at the end of the list.
 *
 * Three axes are proper to this entity. The vaccineWhodrug master, which must exist and
 * be active on write and is never filtered on read — and whose three text columns are
 * never derived from it. The minimum content guard, the only defence against the empty
 * row the DDL admits. And the temporal coherence rule against esaviCase.eventDate, the
 * first rule of the repository that crosses two tables upwards.
 *
 * The fourth axis is the differential update, which here is the clean case of F12:
 * eleven candidates, all compared against what is stored, none derived.
 */
describe('notificationVaccine contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // The data precondition the spec declares: the master is populated by the F19 import,
    // so the suite seeds the two entries it needs — one active and one retired
    let whodrugId: string;
    let inactiveWhodrugId: string;

    const whodrugEntry = async ( code: string, isActive: boolean = true ): Promise<string> => {
        const entry = await VaccineWhodrug.create({
            drugCode: code,
            drugName: `Vaccine ${ code }`,
            isActive
        });
        return entry.getDataValue('vaccineWhodrugId');
    };

    // eventDate is a knob here and not a constant: the temporal coherence rule is the only
    // guard of this entity that reads a column of another table
    const createCaseFixture = async ( eventDate: string | null = '2024-05-04' ): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Vaccine ${ caseCounter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`VC${ caseCounter }${ suffix }`),
            healthSystemCode: `VC${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `VC${ caseCounter }${ suffix }`,
            name: `Vaccine ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `VC-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification over a brand new case. The administered vaccines are recorded the same way
    // whether the notification is severe or not, so the type is fixed and never a fixture knob
    const notifyNewCase = async ( eventDate: string | null = '2024-05-04' ): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture(eventDate);
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createVaccine = ( payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).post('/api/notification-vaccines').set(authHeader(role)).send(payload);

    const getVaccine = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-vaccines/${ id }`).set(authHeader(role));

    const listByNotification = ( notificationId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`/api/notification-vaccines/notification/${ notificationId }${ query }`).set(authHeader(role));

    const listAllByNotification = ( notificationId: string, role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notification-vaccines/admin/notification/${ notificationId }`).set(authHeader(role));

    const listByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-vaccines/case/${ caseId }`).set(authHeader(role));

    const updateVaccine = ( id: string, payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).put(`/api/notification-vaccines/${ id }`).set(authHeader(role)).send(payload);

    const deleteVaccine = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notification-vaccines/${ id }`).set(authHeader(role));

    const activateVaccine = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notification-vaccines/activate/${ id }`).set(authHeader(role));

    const purgeVaccine = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notification-vaccines/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new vaccine over its own notification, ready to be read or updated
    const newVaccine = async ( payload: Record<string, unknown> = {} ): Promise<{ vaccineId: string, notificationId: string, caseId: string }> => {
        const { notificationId, caseId } = await notifyNewCase();
        const created = await createVaccine({ notificationId, vaccineName: 'BCG', ...payload });
        return { vaccineId: created.body.data.vaccineId, notificationId, caseId };
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NotificationVaccine.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const sortOrders = async ( notificationId: string ): Promise<number[]> => {
        const rows = await NotificationVaccine.findAll({
            where: { notificationId },
            order: [[ 'sortOrder', 'ASC' ]]
        });
        return rows.map(row => row.getDataValue('sortOrder') as number);
    };

    const storedSortOrder = async ( id: string ): Promise<number> => {
        const row = await NotificationVaccine.findByPk(id);
        return row!.getDataValue('sortOrder') as number;
    };

    // notificationDiluent has no model — SPEC F22 leaves it out on purpose — so the child rows
    // the 005C cascade destroys are written and counted with raw SQL, the same way the service
    // reads them
    const addDiluent = async ( vaccineId: string ): Promise<void> => {
        await sequelize.query(
            'INSERT INTO "notificationDiluent" ("vaccineId") VALUES (:vaccineId)',
            { replacements: { vaccineId }, type: QueryTypes.INSERT }
        );
    };

    const countDiluents = async ( vaccineId: string ): Promise<number> => {
        const rows = await sequelize.query<{ count: string }>(
            'SELECT COUNT(*)::int AS count FROM "notificationDiluent" WHERE "vaccineId" = :vaccineId',
            { replacements: { vaccineId }, type: QueryTypes.SELECT }
        );
        return Number(rows[0].count);
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        whodrugId = await whodrugEntry(`BCG_${ suffix }`);
        inactiveWhodrugId = await whodrugEntry(`RETIRED_${ suffix }`, false);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the walkthrough', () => {

        it('goes create -> get -> list -> admin list -> by case -> update -> deactivate -> reactivate -> purge', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            // Create
            const created = await createVaccine({
                notificationId,
                vaccineWhodrugId: whodrugId,
                vaccineName: 'BCG',
                batchNumber: 'L-2024-08',
                vaccinationDate: '2024-05-01',
                vaccinationTime: '14:30',
                doseNumber: 1,
                isSuspected: true
            });
            expect(created.status).toBe(201);
            expect(created.body.data.sortOrder).toBe(1);
            expect(created.body.data.vaccineWhodrug.drugName).toBe(`Vaccine BCG_${ suffix }`);
            const vaccineId = created.body.data.vaccineId;

            // Get by id
            expect(( await getVaccine(vaccineId) ).status).toBe(200);

            // List by notification, admin list and list by case
            expect(( await listByNotification(notificationId) ).body.data.count).toBe(1);
            expect(( await listAllByNotification(notificationId) ).body.data.count).toBe(1);
            const byCase = await listByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.count).toBe(1);

            // Update
            const updated = await updateVaccine(vaccineId, { batchNumber: 'L-2024-09' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.batchNumber).toBe('L-2024-09');

            // Deactivate and reactivate
            expect(( await deleteVaccine(vaccineId) ).status).toBe(200);
            expect(( await activateVaccine(vaccineId) ).status).toBe(200);

            // Purge, which needs the row retired first
            await deleteVaccine(vaccineId);
            expect(( await purgeVaccine(vaccineId) ).status).toBe(200);
            expect(await NotificationVaccine.findByPk(vaccineId)).toBeNull();
        });

        it('keeps the five points of the operation code in the audit trail', async () => {
            const { vaccineId } = await newVaccine();
            await updateVaccine(vaccineId, { batchNumber: 'L-1' });
            await deleteVaccine(vaccineId);
            await activateVaccine(vaccineId);

            expect(await auditMethods(vaccineId)).toEqual([
                'ESAVI-NOTIFVAC-001',
                'ESAVI-NOTIFVAC-004',
                'ESAVI-NOTIFVAC-005A',
                'ESAVI-NOTIFVAC-005B'
            ]);
        });

    });

    describe('the vaccineWhodrug master', () => {

        it('answers 404 when the entry is inactive', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createVaccine({ notificationId, vaccineWhodrugId: inactiveWhodrugId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFVAC_001_WHODRUG_NOT_FOUND');
        });

        it('answers 404 when the entry does not exist', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createVaccine({ notificationId, vaccineWhodrugId: unknownUuid });

            expect(response.status).toBe(404);
        });

        it('accepts a vaccine notified without being coded', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createVaccine({ notificationId, vaccineName: 'SRP' });

            expect(response.status).toBe(201);
            expect(response.body.data.vaccineWhodrug).toBeNull();
            expect(response.body.data.vaccineWhodrugId).toBeNull();
        });

        it('keeps resolving an entry retired after the record was written', async () => {
            const { notificationId } = await notifyNewCase();
            const retiredLater = await whodrugEntry(`LATER_${ suffix }`);
            const created = await createVaccine({ notificationId, vaccineWhodrugId: retiredLater });
            expect(created.status).toBe(201);

            await VaccineWhodrug.update({ isActive: false }, { where: { vaccineWhodrugId: retiredLater } });

            const read = await getVaccine(created.body.data.vaccineId);
            expect(read.status).toBe(200);
            expect(read.body.data.vaccineWhodrug.vaccineWhodrugId).toBe(retiredLater);
        });

        it('never derives the three free texts from the master', async () => {
            const { notificationId } = await notifyNewCase();
            const created = await createVaccine({ notificationId, vaccineWhodrugId: whodrugId });

            expect(created.status).toBe(201);
            expect(created.body.data.whoCode).toBeNull();
            expect(created.body.data.vaccineCode).toBeNull();
            expect(created.body.data.vaccineName).toBeNull();
        });

        it('returns exactly three fields of the master', async () => {
            const { vaccineId } = await newVaccine({ vaccineWhodrugId: whodrugId });
            const read = await getVaccine(vaccineId);

            expect(Object.keys(read.body.data.vaccineWhodrug).sort()).toEqual([
                'drugCode', 'drugName', 'vaccineWhodrugId'
            ]);
        });

        it('clears the key with an explicit null when the name survives', async () => {
            const { vaccineId } = await newVaccine({ vaccineWhodrugId: whodrugId, vaccineName: 'BCG' });
            const response = await updateVaccine(vaccineId, { vaccineWhodrugId: null });

            expect(response.status).toBe(200);
            expect(response.body.data.vaccineWhodrug).toBeNull();
        });

    });

    describe('the minimum content guard', () => {

        it('answers 400 when neither the key nor the name arrive', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createVaccine({ notificationId, batchNumber: 'L-1' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFVAC_001_VACCINE_REQUIRED');
        });

        it('answers 400 when an update would leave the row with neither', async () => {
            const { vaccineId } = await newVaccine({ vaccineName: 'BCG' });
            const response = await updateVaccine(vaccineId, { vaccineName: null });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFVAC_004_VACCINE_REQUIRED');
        });

        it('is evaluated over the resulting state and not over the body', async () => {
            const { vaccineId } = await newVaccine({ vaccineWhodrugId: whodrugId, vaccineName: 'BCG' });
            const response = await updateVaccine(vaccineId, { vaccineName: null });

            expect(response.status).toBe(200);
            expect(response.body.data.vaccineName).toBeNull();
        });

    });

    describe('the temporal coherence rule', () => {

        it('answers 400 when the vaccination is later than the event', async () => {
            const { notificationId } = await notifyNewCase('2026-08-10');
            const response = await createVaccine({
                notificationId,
                vaccineName: 'BCG',
                vaccinationDate: '2026-08-12'
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFVAC_001_VACCINATION_AFTER_EVENT');
        });

        it('accepts the very same day', async () => {
            const { notificationId } = await notifyNewCase('2026-08-10');
            const response = await createVaccine({
                notificationId,
                vaccineName: 'BCG',
                vaccinationDate: '2026-08-10'
            });

            expect(response.status).toBe(201);
        });

        it('accepts an earlier vaccination', async () => {
            const { notificationId } = await notifyNewCase('2026-08-10');
            const response = await createVaccine({
                notificationId,
                vaccineName: 'BCG',
                vaccinationDate: '2026-08-01'
            });

            expect(response.status).toBe(201);
        });

        it('does not apply when the case has no eventDate', async () => {
            const { notificationId } = await notifyNewCase(null);
            const response = await createVaccine({
                notificationId,
                vaccineName: 'BCG',
                vaccinationDate: '2026-12-31'
            });

            expect(response.status).toBe(201);
        });

        it('does not apply when the vaccine has no vaccinationDate', async () => {
            const { notificationId } = await notifyNewCase('2026-08-10');
            const response = await createVaccine({ notificationId, vaccineName: 'BCG' });

            expect(response.status).toBe(201);
        });

        it('answers 400 on update even when nothing else changes', async () => {
            const { notificationId } = await notifyNewCase('2026-08-10');
            const created = await createVaccine({
                notificationId,
                vaccineName: 'BCG',
                vaccinationDate: '2026-08-01'
            });
            const response = await updateVaccine(created.body.data.vaccineId, { vaccinationDate: '2026-09-01' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFVAC_004_VACCINATION_AFTER_EVENT');
        });

    });

    describe('order and state', () => {

        it('lets the trigger assign 1, 2 and 3 without any service sending the column', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'BCG', 'SRP', 'DPT' ] ) {
                await createVaccine({ notificationId, vaccineName: name });
            }

            expect(await sortOrders(notificationId)).toEqual([ 1, 2, 3 ]);
        });

        it('ignores a sortOrder sent in the body without answering 400', async () => {
            const { vaccineId } = await newVaccine();
            const before = await storedSortOrder(vaccineId);

            const response = await updateVaccine(vaccineId, { sortOrder: 99 });

            expect(response.status).toBe(200);
            expect(await storedSortOrder(vaccineId)).toBe(before);
        });

        it('survives the sortOrder collision of the reactivation', async () => {
            const { notificationId } = await notifyNewCase();
            const ids: string[] = [];
            for( const name of [ 'BCG', 'SRP', 'DPT' ] ) {
                const created = await createVaccine({ notificationId, vaccineName: name });
                ids.push(created.body.data.vaccineId);
            }

            // The third one is retired, which frees its number
            await deleteVaccine(ids[2]);

            // A fourth one legitimately takes the freed 3
            const fourth = await createVaccine({ notificationId, vaccineName: 'VPH' });
            expect(fourth.body.data.sortOrder).toBe(3);

            // Bringing the third one back must answer 200 and land at the end of the list
            const reactivated = await activateVaccine(ids[2]);
            expect(reactivated.status).toBe(200);
            expect(await storedSortOrder(ids[2])).toBe(4);
        });

        it('does not move the sortOrder when the number is still free', async () => {
            const { vaccineId } = await newVaccine();
            const before = await storedSortOrder(vaccineId);
            await deleteVaccine(vaccineId);

            expect(( await activateVaccine(vaccineId) ).status).toBe(200);
            expect(await storedSortOrder(vaccineId)).toBe(before);
        });

        it('reactivates a vaccine whose master entry was retired in the meantime', async () => {
            const retiredLater = await whodrugEntry(`MEANWHILE_${ suffix }`);
            const { vaccineId } = await newVaccine({ vaccineWhodrugId: retiredLater });
            await deleteVaccine(vaccineId);
            await VaccineWhodrug.update({ isActive: false }, { where: { vaccineWhodrugId: retiredLater } });

            expect(( await activateVaccine(vaccineId) ).status).toBe(200);
        });

        it('answers 409 when deactivating twice and when reactivating a live row', async () => {
            const { vaccineId } = await newVaccine();

            expect(( await deleteVaccine(vaccineId) ).status).toBe(200);
            expect(( await deleteVaccine(vaccineId) ).status).toBe(409);
            expect(( await activateVaccine(vaccineId) ).status).toBe(200);
            expect(( await activateVaccine(vaccineId) ).status).toBe(409);
        });

        it('answers 409 when purging a live row', async () => {
            const { vaccineId } = await newVaccine();
            const response = await purgeVaccine(vaccineId);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFVAC_005C_STILL_ACTIVE');
        });

        it('purges a retired vaccine whose notification is still active', async () => {
            const { vaccineId } = await newVaccine();
            await deleteVaccine(vaccineId);

            expect(( await purgeVaccine(vaccineId) ).status).toBe(200);
        });

    });

    describe('the notificationDiluent child table', () => {

        it('drags the diluents of the purged vaccine', async () => {
            const { vaccineId } = await newVaccine();
            await addDiluent(vaccineId);
            await addDiluent(vaccineId);
            expect(await countDiluents(vaccineId)).toBe(2);

            await deleteVaccine(vaccineId);
            expect(( await purgeVaccine(vaccineId) ).status).toBe(200);
            expect(await countDiluents(vaccineId)).toBe(0);
        });

        it('does not block the deactivation of a vaccine with live diluents', async () => {
            const { vaccineId } = await newVaccine();
            await addDiluent(vaccineId);

            expect(( await deleteVaccine(vaccineId) ).status).toBe(200);
            expect(await countDiluents(vaccineId)).toBe(1);
        });

        it('never exposes the diluents in the response', async () => {
            const { vaccineId } = await newVaccine();
            await addDiluent(vaccineId);
            const read = await getVaccine(vaccineId);

            expect(read.body.data.diluents).toBeUndefined();
            expect(JSON.stringify(read.body.data)).not.toContain('diluent');
        });

    });

    describe('the inherited visibility', () => {

        it('hides a vaccine whose notification was retired, and shows it to SUPERADMIN', async () => {
            const { vaccineId, notificationId } = await newVaccine();
            await deactivateNotification(notificationId);

            expect(( await getVaccine(vaccineId, 'USER') ).status).toBe(404);
            expect(( await getVaccine(vaccineId, 'ADMIN') ).status).toBe(404);
            expect(( await getVaccine(vaccineId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 404 when creating over a retired notification', async () => {
            const { notificationId } = await notifyNewCase();
            await deactivateNotification(notificationId);

            const response = await createVaccine({ notificationId, vaccineName: 'BCG' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFVAC_001_NOTIFICATION_NOT_FOUND');
        });

        it('answers 404 for a listing over a retired notification', async () => {
            const { notificationId } = await newVaccine();
            await deactivateNotification(notificationId);

            expect(( await listByNotification(notificationId, 'USER') ).status).toBe(404);
        });

        it('answers 404 when the case of the 006 does not exist', async () => {
            const response = await listByCase(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFVAC_006_CASE_NOT_FOUND');
        });

        it('answers 400 of UUID and not 404 for a non UUID captured as an id', async () => {
            const response = await getVaccine('algo');

            expect(response.status).toBe(400);
        });

        // /activate/:id is two segments, so a GET matches no route of this router at all: the
        // 404 comes from the application and never from the vaccine service, which is what the
        // ordering of the literal paths before /:id is there to guarantee
        it('never reaches the service through the literal activate path', async () => {
            const response = await request(app)
                .get('/api/notification-vaccines/activate/algo')
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).not.toBe('NOTIFVAC_003_NOT_FOUND');
        });

        it('keeps a retired vaccine out of the public listing and inside the admin one', async () => {
            const { vaccineId, notificationId } = await newVaccine();
            await deleteVaccine(vaccineId);

            expect(( await listByNotification(notificationId) ).body.data.count).toBe(0);
            expect(( await listAllByNotification(notificationId) ).body.data.count).toBe(1);
        });

    });

    describe('the differential update', () => {

        it('writes nothing when the response of the GET is sent back whole', async () => {
            const { vaccineId } = await newVaccine({
                vaccineWhodrugId: whodrugId,
                vaccineName: 'BCG',
                batchNumber: 'L-2024-08',
                vaccinationDate: '2024-05-01',
                vaccinationTime: '14:30',
                doseNumber: 2,
                notes: 'Second dose'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notification-vaccines',
                id: vaccineId,
                model: NotificationVaccine
            });
        });

        it('writes nothing for an empty body', async () => {
            const { vaccineId } = await newVaccine();
            const before = await auditMethods(vaccineId);

            const response = await updateVaccine(vaccineId, {});

            expect(response.status).toBe(200);
            expect(await auditMethods(vaccineId)).toEqual(before);
        });

        it('adds one audit entry when a single field changes', async () => {
            const { vaccineId } = await newVaccine();

            await updateVaccine(vaccineId, { batchNumber: 'L-2' });

            expect(await auditMethods(vaccineId)).toEqual([ 'ESAVI-NOTIFVAC-001', 'ESAVI-NOTIFVAC-004' ]);
        });

        it('writes nothing when only the spacing of a text changes', async () => {
            const { vaccineId } = await newVaccine({ vaccineName: 'BCG' });
            const before = await auditMethods(vaccineId);

            const response = await updateVaccine(vaccineId, { vaccineName: '  BCG  ' });

            expect(response.status).toBe(200);
            expect(await auditMethods(vaccineId)).toEqual(before);
        });

        it('does write when only the casing of the name changes', async () => {
            const { vaccineId } = await newVaccine({ vaccineName: 'BCG' });

            const response = await updateVaccine(vaccineId, { vaccineName: 'bcg' });

            expect(response.status).toBe(200);
            expect(response.body.data.vaccineName).toBe('bcg');
            expect(await auditMethods(vaccineId)).toHaveLength(2);
        });

        it('writes nothing when a time arrives without its seconds', async () => {
            const { vaccineId } = await newVaccine({ vaccinationTime: '14:30' });
            const before = await auditMethods(vaccineId);

            const response = await updateVaccine(vaccineId, { vaccinationTime: '14:30' });

            expect(response.status).toBe(200);
            expect(await auditMethods(vaccineId)).toEqual(before);
        });

        it('turns an empty text into an absent one', async () => {
            const { vaccineId } = await newVaccine({ whoCode: 'J07AN01' });

            const response = await updateVaccine(vaccineId, { whoCode: '' });

            expect(response.status).toBe(200);
            expect(response.body.data.whoCode).toBeNull();
        });

        it('does write when a boolean goes back to false', async () => {
            const { vaccineId } = await newVaccine({ isSuspected: true });

            const response = await updateVaccine(vaccineId, { isSuspected: false });

            expect(response.status).toBe(200);
            expect(response.body.data.isSuspected).toBe(false);
            expect(await auditMethods(vaccineId)).toHaveLength(2);
        });

        it('leaves every other column untouched when one changes', async () => {
            const { vaccineId } = await newVaccine({
                vaccineWhodrugId: whodrugId,
                vaccineName: 'BCG',
                vaccinationDate: '2024-05-01',
                expirationDate: '2025-01-01',
                doseNumber: 1
            });

            const response = await updateVaccine(vaccineId, { batchNumber: 'L-3' });

            expect(response.body.data.vaccineWhodrugId).toBe(whodrugId);
            expect(response.body.data.vaccineName).toBe('BCG');
            expect(response.body.data.vaccinationDate).toBe('2024-05-01');
            expect(response.body.data.expirationDate).toBe('2025-01-01');
            expect(response.body.data.doseNumber).toBe(1);
        });

        it('answers 404 for a retired master entry even when nothing else changes', async () => {
            const { vaccineId } = await newVaccine({ vaccineName: 'BCG' });

            const response = await updateVaccine(vaccineId, { vaccineWhodrugId: inactiveWhodrugId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFVAC_004_WHODRUG_NOT_FOUND');
        });

    });

    describe('the cascade of ESAVI-NOTIFCN-005C', () => {

        it('drags every vaccine of the purged notification', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'BCG', 'SRP', 'DPT' ] ) {
                await createVaccine({ notificationId, vaccineName: name });
            }
            await deactivateNotification(notificationId);

            const purged = await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await NotificationVaccine.count({ where: { notificationId } })).toBe(0);
        });

    });

});
