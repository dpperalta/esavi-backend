import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { DiluentCatalog, EsaviCase, HealthFacility, NotificationDiluent, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the eight notificationDiluent operations of SPEC F24. It walks the
 * entity end to end — create, read by id, list by vaccine, admin list, update,
 * deactivate, reactivate, purge — and covers what cannot be checked by hand reliably.
 *
 * This is the sixth satellite of notification and the fourth one to many, so it inherits
 * the sortOrder collision F16 faced and F21 and F22 reconfirmed: the partial unique index
 * is conditioned by deletedAt, so a 005A frees the number, a later create reuses it, and
 * reactivating the old row would blow the index up. The suite runs those four movements
 * literally and expects the reactivated diluent at the end of the list.
 *
 * What is structurally new here is the inherited visibility in chain. This is the first
 * grandchild of the graph — it hangs from vaccineId, not from notificationId — so the rule
 * is two hops, and the two failures are two distinct scenarios: a retired vaccine, and a
 * retired notification under an active vaccine. Both are mounted separately on purpose.
 *
 * Three more axes are proper to this entity. The diluentCatalog master, which must exist
 * and be active on write, is never filtered on read, and from which no field is ever
 * derived. The minimum content guard, which here is the only defence against a row where
 * every one of the seven data columns is nullable. And the temporal coherence rule against
 * notificationVaccine.vaccinationDate, a single hop that never reaches esaviCase.
 */
describe('notificationDiluent contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const logFile = path.join(__dirname, '..', '..', 'src', 'logs', 'esaviLog.log');

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // The data precondition the spec declares: the master is populated by hand, so the suite
    // seeds the two entries it needs — one active and one retired
    let catalogId: string;
    let inactiveCatalogId: string;

    const catalogEntry = async ( code: string, isActive: boolean = true ): Promise<string> => {
        const entry = await DiluentCatalog.create({
            code,
            name: `Diluent ${ code }`,
            composition: 'Water for injection',
            isActive
        });
        return entry.getDataValue('diluentCatalogId');
    };

    // eventDate defaults far ahead so the temporal rule of F22 never gets in the way: what this
    // suite exercises is the rule of its own entity, one hop below
    const createCaseFixture = async ( eventDate: string | null = '2026-12-31' ): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Diluent ${ caseCounter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`DL${ caseCounter }${ suffix }`),
            healthSystemCode: `DL${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `DL${ caseCounter }${ suffix }`,
            name: `Diluent ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `DL-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    const notifyNewCase = async (): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createDiluent = ( payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).post('/api/notification-diluents').set(authHeader(role)).send(payload);

    const getDiluent = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-diluents/${ id }`).set(authHeader(role));

    const listByVaccine = ( vaccineId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`/api/notification-diluents/vaccine/${ vaccineId }${ query }`).set(authHeader(role));

    const listAllByVaccine = ( vaccineId: string, role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notification-diluents/admin/vaccine/${ vaccineId }`).set(authHeader(role));

    const updateDiluent = ( id: string, payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).put(`/api/notification-diluents/${ id }`).set(authHeader(role)).send(payload);

    const deleteDiluent = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notification-diluents/${ id }`).set(authHeader(role));

    const activateDiluent = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notification-diluents/activate/${ id }`).set(authHeader(role));

    const purgeDiluent = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notification-diluents/purge/${ id }`).set(authHeader(role));

    const deactivateVaccine = ( id: string ) =>
        request(app).delete(`/api/notification-vaccines/${ id }`).set(authHeader('ADMIN'));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new vaccine over its own notification, which is the parent every diluent needs
    const newVaccine = async ( payload: Record<string, unknown> = {} ): Promise<{ vaccineId: string, notificationId: string, caseId: string }> => {
        const { notificationId, caseId } = await notifyNewCase();
        const created = await request(app)
            .post('/api/notification-vaccines')
            .set(authHeader('ADMIN'))
            .send({ notificationId, vaccineName: 'BCG', ...payload });
        return { vaccineId: created.body.data.vaccineId, notificationId, caseId };
    };

    // A brand new diluent over its own vaccine, ready to be read or updated
    const newDiluent = async ( payload: Record<string, unknown> = {} ): Promise<{ diluentId: string, vaccineId: string, notificationId: string }> => {
        const { vaccineId, notificationId } = await newVaccine();
        const created = await createDiluent({ vaccineId, diluentName: 'Agua estéril', ...payload });
        return { diluentId: created.body.data.diluentId, vaccineId, notificationId };
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NotificationDiluent.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const sortOrders = async ( vaccineId: string ): Promise<number[]> => {
        const rows = await NotificationDiluent.findAll({
            where: { vaccineId },
            order: [[ 'sortOrder', 'ASC' ]]
        });
        return rows.map(row => row.getDataValue('sortOrder') as number);
    };

    const storedSortOrder = async ( id: string ): Promise<number> => {
        const row = await NotificationDiluent.findByPk(id);
        return row!.getDataValue('sortOrder') as number;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        catalogId = await catalogEntry(`WFI_${ suffix }`);
        inactiveCatalogId = await catalogEntry(`RETIRED_${ suffix }`, false);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the walkthrough', () => {

        it('goes create -> get -> list -> admin list -> update -> deactivate -> reactivate -> purge', async () => {
            const { vaccineId } = await newVaccine();

            // Create
            const created = await createDiluent({
                vaccineId,
                diluentCatalogId: catalogId,
                diluentName: 'Agua estéril',
                diluentCode: 'WFI',
                batchNumber: 'L-2026-08',
                expirationDate: '2027-01-31',
                reconstitutionDate: '2026-08-10',
                reconstitutionTime: '09:15'
            });
            expect(created.status).toBe(201);
            expect(created.body.data.sortOrder).toBe(1);
            expect(created.body.data.diluentCatalog.name).toBe(`Diluent WFI_${ suffix }`);
            const diluentId = created.body.data.diluentId;

            // Get by id
            expect(( await getDiluent(diluentId) ).status).toBe(200);

            // List by vaccine and admin list
            expect(( await listByVaccine(vaccineId) ).body.data.count).toBe(1);
            expect(( await listAllByVaccine(vaccineId) ).body.data.count).toBe(1);

            // Update
            const updated = await updateDiluent(diluentId, { batchNumber: 'L-2026-09' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.batchNumber).toBe('L-2026-09');

            // Deactivate and reactivate
            expect(( await deleteDiluent(diluentId) ).status).toBe(200);
            expect(( await activateDiluent(diluentId) ).status).toBe(200);

            // Purge, which needs the row retired first
            await deleteDiluent(diluentId);
            const purged = await purgeDiluent(diluentId);
            expect(purged.status).toBe(200);
            expect(purged.body.data).toBeUndefined();
            expect(await NotificationDiluent.findByPk(diluentId, { paranoid: false })).toBeNull();
        });

        it('keeps the five points of the operation code in appDetails', async () => {
            const { diluentId } = await newDiluent();
            await updateDiluent(diluentId, { batchNumber: 'L-2026-10' });
            await deleteDiluent(diluentId);
            await activateDiluent(diluentId);

            expect(await auditMethods(diluentId)).toEqual([
                'ESAVI-NOTIFDIL-001',
                'ESAVI-NOTIFDIL-004',
                'ESAVI-NOTIFDIL-005A',
                'ESAVI-NOTIFDIL-005B'
            ]);
        });

        it('never exposes sysDetails and never returns the parent chain', async () => {
            const { diluentId } = await newDiluent();
            const response = await getDiluent(diluentId);

            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.vaccine).toBeUndefined();
            expect(response.body.data.notification).toBeUndefined();
            // The raw foreign key travels next to the resolved object, so a PUT resending the GET
            // finds it where it expects it
            expect(response.body.data).toHaveProperty('diluentCatalogId');
        });

        it('answers 404 for an id that does not exist', async () => {
            expect(( await getDiluent(unknownUuid) ).status).toBe(404);
            expect(( await updateDiluent(unknownUuid, { batchNumber: 'X' }) ).status).toBe(404);
            expect(( await deleteDiluent(unknownUuid) ).status).toBe(404);
            expect(( await activateDiluent(unknownUuid) ).status).toBe(404);
            expect(( await purgeDiluent(unknownUuid) ).status).toBe(404);
        });

    });

    describe('the diluentCatalog master', () => {

        it('creates with an active entry and resolves it with exactly three fields', async () => {
            const { vaccineId } = await newVaccine();
            const created = await createDiluent({ vaccineId, diluentCatalogId: catalogId });

            expect(created.status).toBe(201);
            expect(Object.keys(created.body.data.diluentCatalog).sort())
                .toEqual([ 'code', 'diluentCatalogId', 'name' ]);
        });

        it('answers 404 for an inactive entry and for one that does not exist', async () => {
            const { vaccineId } = await newVaccine();

            expect(( await createDiluent({ vaccineId, diluentCatalogId: inactiveCatalogId }) ).status).toBe(404);
            expect(( await createDiluent({ vaccineId, diluentCatalogId: unknownUuid }) ).status).toBe(404);
        });

        it('creates with the name alone and comes back with an explicit null', async () => {
            const { vaccineId } = await newVaccine();
            const created = await createDiluent({ vaccineId, diluentName: 'Agua estéril' });

            expect(created.status).toBe(201);
            expect(created.body.data.diluentCatalog).toBeNull();
        });

        it('clears the key with an explicit null when the row keeps its name', async () => {
            const { diluentId } = await newDiluent({ diluentCatalogId: catalogId, diluentName: 'Agua estéril' });
            const updated = await updateDiluent(diluentId, { diluentCatalogId: null });

            expect(updated.status).toBe(200);
            expect(updated.body.data.diluentCatalogId).toBeNull();
            expect(updated.body.data.diluentCatalog).toBeNull();
        });

        it('refuses to clear the key when the row has no name left', async () => {
            const { vaccineId } = await newVaccine();
            const created = await createDiluent({ vaccineId, diluentCatalogId: catalogId });
            const updated = await updateDiluent(created.body.data.diluentId, { diluentCatalogId: null });

            expect(updated.status).toBe(400);
        });

        it('keeps returning an entry retired after the record was written', async () => {
            const { vaccineId } = await newVaccine();
            const temporaryId = await catalogEntry(`TEMP_${ suffix }`);
            const created = await createDiluent({ vaccineId, diluentCatalogId: temporaryId });
            await DiluentCatalog.update({ isActive: false }, { where: { diluentCatalogId: temporaryId } });

            const response = await getDiluent(created.body.data.diluentId);
            expect(response.status).toBe(200);
            expect(response.body.data.diluentCatalog.diluentCatalogId).toBe(temporaryId);
        });

        it('derives no field from the master: a PUT with only the key rewrites no text', async () => {
            const { diluentId } = await newDiluent({ diluentName: 'Lo que decía el vial', diluentCode: 'VIAL-1' });
            const updated = await updateDiluent(diluentId, { diluentCatalogId: catalogId });

            expect(updated.status).toBe(200);
            expect(updated.body.data.diluentName).toBe('Lo que decía el vial');
            expect(updated.body.data.diluentCode).toBe('VIAL-1');
        });

    });

    describe('the minimum content guard', () => {

        it('answers 400 when neither the key nor the name arrives', async () => {
            const { vaccineId } = await newVaccine();
            const created = await createDiluent({ vaccineId, batchNumber: 'L-2026-08' });

            expect(created.status).toBe(400);
        });

        it('answers 400 for a name that is blank after trimming', async () => {
            const { vaccineId } = await newVaccine();

            expect(( await createDiluent({ vaccineId, diluentName: '   ' }) ).status).toBe(400);
        });

        it('is evaluated over the resulting state and not over the body', async () => {
            // The row keeps its key, so clearing the name is legitimate
            const withKey = await newDiluent({ diluentCatalogId: catalogId, diluentName: 'Agua estéril' });
            expect(( await updateDiluent(withKey.diluentId, { diluentName: null }) ).status).toBe(200);

            // This one has no key, so clearing the name would empty the row
            const withoutKey = await newDiluent({ diluentName: 'Agua estéril' });
            expect(( await updateDiluent(withoutKey.diluentId, { diluentName: null }) ).status).toBe(400);
        });

    });

    describe('the temporal coherence rule', () => {

        it('answers 400 when the reconstitution is later than the vaccination', async () => {
            const { vaccineId } = await newVaccine({ vaccinationDate: '2026-08-10' });
            const created = await createDiluent({ vaccineId, diluentName: 'Agua', reconstitutionDate: '2026-08-11' });

            expect(created.status).toBe(400);
        });

        it('accepts the same day, which is the normal case and not a tolerated exception', async () => {
            const { vaccineId } = await newVaccine({ vaccinationDate: '2026-08-10' });

            expect(( await createDiluent({ vaccineId, diluentName: 'Agua', reconstitutionDate: '2026-08-10' }) ).status).toBe(201);
        });

        it('accepts an earlier day', async () => {
            const { vaccineId } = await newVaccine({ vaccinationDate: '2026-08-10' });

            expect(( await createDiluent({ vaccineId, diluentName: 'Agua', reconstitutionDate: '2026-08-09' }) ).status).toBe(201);
        });

        it('does not apply when either date is missing', async () => {
            const withoutVaccination = await newVaccine();
            expect(( await createDiluent({
                vaccineId: withoutVaccination.vaccineId,
                diluentName: 'Agua',
                reconstitutionDate: '2026-08-11'
            }) ).status).toBe(201);

            const withVaccination = await newVaccine({ vaccinationDate: '2026-08-10' });
            expect(( await createDiluent({ vaccineId: withVaccination.vaccineId, diluentName: 'Agua' }) ).status).toBe(201);
        });

        it('answers 400 on a PUT that moves the date beyond the vaccination', async () => {
            const { vaccineId } = await newVaccine({ vaccinationDate: '2026-08-10' });
            const created = await createDiluent({ vaccineId, diluentName: 'Agua', reconstitutionDate: '2026-08-09' });
            const updated = await updateDiluent(created.body.data.diluentId, { reconstitutionDate: '2026-08-11' });

            expect(updated.status).toBe(400);
        });

    });

    describe('the inherited visibility in chain', () => {

        it('hides a diluent whose vaccine was retired, and shows it to SUPERADMIN', async () => {
            const { diluentId, vaccineId } = await newDiluent();
            await deactivateVaccine(vaccineId);

            expect(( await getDiluent(diluentId, 'USER') ).status).toBe(404);
            expect(( await getDiluent(diluentId, 'ADMIN') ).status).toBe(404);
            expect(( await getDiluent(diluentId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('hides a diluent whose notification was retired, with the vaccine still active', async () => {
            const { diluentId, notificationId } = await newDiluent();
            await deactivateNotification(notificationId);

            expect(( await getDiluent(diluentId, 'USER') ).status).toBe(404);
            expect(( await getDiluent(diluentId, 'ADMIN') ).status).toBe(404);
            expect(( await getDiluent(diluentId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('hides a diluent retired on its own, with both parents active', async () => {
            const { diluentId } = await newDiluent();
            await deleteDiluent(diluentId);

            expect(( await getDiluent(diluentId, 'USER') ).status).toBe(404);
            expect(( await getDiluent(diluentId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 404 on create over a retired vaccine and over a retired notification', async () => {
            const retiredVaccine = await newVaccine();
            await deactivateVaccine(retiredVaccine.vaccineId);
            expect(( await createDiluent({ vaccineId: retiredVaccine.vaccineId, diluentName: 'Agua' }) ).status).toBe(404);

            const retiredNotification = await newVaccine();
            await deactivateNotification(retiredNotification.notificationId);
            expect(( await createDiluent({ vaccineId: retiredNotification.vaccineId, diluentName: 'Agua' }) ).status).toBe(404);
        });

        it('applies the same chain to the two listings', async () => {
            const { vaccineId, notificationId } = await newDiluent();
            await deactivateNotification(notificationId);

            expect(( await listByVaccine(vaccineId, 'USER') ).status).toBe(404);
            expect(( await listAllByVaccine(vaccineId, 'ADMIN') ).status).toBe(404);
            expect(( await listByVaccine(vaccineId, 'SUPERADMIN') ).status).toBe(200);
        });

        // /activate/:id is two segments, so a GET matches no route of this router at all: the 404
        // comes from the application and never from the diluent service, which is what the ordering
        // of the literal paths before /:id is there to guarantee. The criterion of §5 reads "400 of
        // UUID", but that shape is unreachable for a two segment path — F22 hit the same wall and
        // resolved it the same way
        it('never reaches the service through the literal activate path', async () => {
            const response = await request(app)
                .get('/api/notification-diluents/activate/algo')
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).not.toBe('NOTIFDIL_003_NOT_FOUND');
        });

        // The 400 of UUID the criterion asks for, on the shape that can actually produce it: a
        // single segment that is not a UUID does reach /:id, and the validator stops it before the
        // service
        it('answers 400 of UUID for a single segment that is not one', async () => {
            const response = await request(app)
                .get('/api/notification-diluents/algo')
                .set(authHeader('USER'));

            expect(response.status).toBe(400);
        });

    });

    describe('the listings', () => {

        it('orders by sortOrder and drops the retired rows from the 002A', async () => {
            const { vaccineId } = await newVaccine();
            await createDiluent({ vaccineId, diluentName: 'A' });
            const second = await createDiluent({ vaccineId, diluentName: 'B' });
            await createDiluent({ vaccineId, diluentName: 'C' });

            const before = await listByVaccine(vaccineId);
            expect(before.body.data.count).toBe(3);
            expect(before.body.data.rows.map(( row: { diluentName: string } ) => row.diluentName)).toEqual([ 'A', 'B', 'C' ]);

            await deleteDiluent(second.body.data.diluentId);

            const after = await listByVaccine(vaccineId);
            expect(after.body.data.count).toBe(2);
            expect(after.body.data.rows.map(( row: { diluentName: string } ) => row.diluentName)).toEqual([ 'A', 'C' ]);

            // The admin listing is the only door to the retired row
            const admin = await listAllByVaccine(vaccineId);
            expect(admin.body.data.count).toBe(3);
        });

        it('answers 403 to a USER on the admin listing', async () => {
            const { vaccineId } = await newVaccine();

            expect(( await listAllByVaccine(vaccineId, 'USER') ).status).toBe(403);
        });

    });

    describe('order and state', () => {

        it('lets the trigger assign 1, 2 and 3 without any service sending the field', async () => {
            const { vaccineId } = await newVaccine();
            await createDiluent({ vaccineId, diluentName: 'A' });
            await createDiluent({ vaccineId, diluentName: 'B' });
            await createDiluent({ vaccineId, diluentName: 'C' });

            expect(await sortOrders(vaccineId)).toEqual([ 1, 2, 3 ]);
        });

        it('ignores a sortOrder sent in the body, with no 400', async () => {
            const { diluentId } = await newDiluent();
            const before = await storedSortOrder(diluentId);

            const updated = await updateDiluent(diluentId, { sortOrder: 99 });
            expect(updated.status).toBe(200);
            expect(await storedSortOrder(diluentId)).toBe(before);
        });

        it('reassigns the sortOrder when reactivating a row whose number was taken', async () => {
            const { vaccineId } = await newVaccine();
            await createDiluent({ vaccineId, diluentName: 'A' });
            await createDiluent({ vaccineId, diluentName: 'B' });
            const third = await createDiluent({ vaccineId, diluentName: 'C' });
            const thirdId = third.body.data.diluentId;
            expect(third.body.data.sortOrder).toBe(3);

            // The 005A seals deletedAt, which frees the number from the partial unique index
            await deleteDiluent(thirdId);

            // So the next create legitimately takes it
            const fourth = await createDiluent({ vaccineId, diluentName: 'D' });
            expect(fourth.body.data.sortOrder).toBe(3);

            // And the reactivation must move the old row instead of blowing the index up
            const reactivated = await activateDiluent(thirdId);
            expect(reactivated.status).toBe(200);
            expect(await storedSortOrder(thirdId)).toBe(4);
        });

        it('leaves the sortOrder alone when reactivating a row whose number is still free', async () => {
            const { vaccineId } = await newVaccine();
            await createDiluent({ vaccineId, diluentName: 'A' });
            const second = await createDiluent({ vaccineId, diluentName: 'B' });
            const secondId = second.body.data.diluentId;

            await deleteDiluent(secondId);
            expect(( await activateDiluent(secondId) ).status).toBe(200);
            expect(await storedSortOrder(secondId)).toBe(2);
        });

        it('revalidates nothing on reactivation: not the master, not the parent vaccine', async () => {
            const temporaryId = await catalogEntry(`GONE_${ suffix }`);
            const { vaccineId } = await newVaccine();
            const created = await createDiluent({ vaccineId, diluentCatalogId: temporaryId });
            const diluentId = created.body.data.diluentId;

            await deleteDiluent(diluentId);
            await DiluentCatalog.update({ isActive: false }, { where: { diluentCatalogId: temporaryId } });
            expect(( await activateDiluent(diluentId) ).status).toBe(200);

            const other = await newDiluent();
            await deleteDiluent(other.diluentId);
            await deactivateVaccine(other.vaccineId);
            expect(( await activateDiluent(other.diluentId) ).status).toBe(200);
        });

        it('answers 409 when deactivating twice and when reactivating an active row', async () => {
            const { diluentId } = await newDiluent();

            expect(( await deleteDiluent(diluentId) ).status).toBe(200);
            expect(( await deleteDiluent(diluentId) ).status).toBe(409);
            expect(( await activateDiluent(diluentId) ).status).toBe(200);
            expect(( await activateDiluent(diluentId) ).status).toBe(409);
        });

        it('does not block the 005A of a vaccine that still has live diluents', async () => {
            const { vaccineId, diluentId } = await newDiluent();

            expect(( await deactivateVaccine(vaccineId) ).status).toBe(200);
            const row = await NotificationDiluent.findByPk(diluentId);
            expect(row!.getDataValue('isActive')).toBe(true);
        });

    });

    describe('the leaf of the graph', () => {

        it('answers 409 when purging a row that is still active', async () => {
            const { diluentId } = await newDiluent();

            expect(( await purgeDiluent(diluentId) ).status).toBe(409);
        });

        it('purges a retired row whose vaccine is still active', async () => {
            const { diluentId } = await newDiluent();
            await deleteDiluent(diluentId);

            expect(( await purgeDiluent(diluentId) ).status).toBe(200);
            expect(await NotificationDiluent.findByPk(diluentId, { paranoid: false })).toBeNull();
        });

        it('leaves the single dump of the destroyed row and no cascade line', async () => {
            const { diluentId } = await newDiluent();
            await deleteDiluent(diluentId);
            await purgeDiluent(diluentId);

            const lines = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes(diluentId) && line.includes('[WARN]'));

            expect(lines.filter(line => line.includes('Snapshot:'))).toHaveLength(1);
            expect(lines.filter(line => line.includes('dragged by'))).toHaveLength(0);
        });

    });

    describe('the differential update', () => {

        it('writes nothing when the response of the GET is sent back whole', async () => {
            const { diluentId } = await newDiluent({
                diluentCatalogId: catalogId,
                batchNumber: 'L-2026-08',
                expirationDate: '2027-01-31',
                reconstitutionDate: '2026-08-10',
                reconstitutionTime: '09:15:00'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notification-diluents',
                id: diluentId,
                model: NotificationDiluent
            });
        });

        it('writes nothing for an empty body', async () => {
            const { diluentId } = await newDiluent();
            const before = await NotificationDiluent.findByPk(diluentId);

            const response = await updateDiluent(diluentId, {});
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);

            const after = await NotificationDiluent.findByPk(diluentId);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

        it('adds exactly one audit entry and one version when a single field changes', async () => {
            const { diluentId } = await newDiluent();
            const before = await NotificationDiluent.findByPk(diluentId);
            const versionBefore = ( before!.getDataValue('sysDetails') as { version?: number } ).version ?? 0;

            const response = await updateDiluent(diluentId, { batchNumber: 'L-2026-11' });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(2);

            const after = await NotificationDiluent.findByPk(diluentId);
            expect(( after!.getDataValue('sysDetails') as { version?: number } ).version).toBe(versionBefore + 1);
        });

        it('answers 404 for an inactive master entry even when nothing else changes', async () => {
            const { diluentId } = await newDiluent({ diluentName: 'Agua estéril' });
            const updated = await updateDiluent(diluentId, {
                diluentCatalogId: inactiveCatalogId,
                diluentName: 'Agua estéril'
            });

            expect(updated.status).toBe(404);
        });

        it('trims before comparing, so surrounding blanks write nothing', async () => {
            const { diluentId } = await newDiluent({ diluentName: 'Agua estéril' });
            const before = await NotificationDiluent.findByPk(diluentId);

            const response = await updateDiluent(diluentId, { diluentName: '  Agua estéril  ' });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);

            const after = await NotificationDiluent.findByPk(diluentId);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

        it('does write for a change of case: there is no toTitleCase here', async () => {
            const { diluentId } = await newDiluent({ diluentName: 'Agua estéril' });

            const response = await updateDiluent(diluentId, { diluentName: 'agua estéril' });
            expect(response.status).toBe(200);
            expect(response.body.data.diluentName).toBe('agua estéril');
            expect(response.body.data.appDetails).toHaveLength(2);
        });

        it('pads the time before comparing, so HH:MM over HH:MM:SS writes nothing', async () => {
            const { diluentId } = await newDiluent({ reconstitutionTime: '09:15:00' });
            const before = await NotificationDiluent.findByPk(diluentId);

            const response = await updateDiluent(diluentId, { reconstitutionTime: '09:15' });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);

            const after = await NotificationDiluent.findByPk(diluentId);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

        it('turns an empty string into an absence', async () => {
            const { diluentId } = await newDiluent({ diluentCode: 'WFI' });
            const updated = await updateDiluent(diluentId, { diluentCode: '' });

            expect(updated.status).toBe(200);
            expect(updated.body.data.diluentCode).toBeNull();
        });

        it('leaves every other field untouched when only one changes', async () => {
            const { diluentId } = await newDiluent({
                diluentCatalogId: catalogId,
                batchNumber: 'L-2026-08',
                expirationDate: '2027-01-31',
                reconstitutionDate: '2026-08-10',
                reconstitutionTime: '09:15:00'
            });

            const updated = await updateDiluent(diluentId, { batchNumber: 'L-2026-12' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.diluentCatalogId).toBe(catalogId);
            expect(updated.body.data.expirationDate).toBe('2027-01-31');
            expect(updated.body.data.reconstitutionDate).toBe('2026-08-10');
            expect(updated.body.data.reconstitutionTime).toBe('09:15:00');
        });

        it('ignores an immutable vaccineId in silence, with no 400', async () => {
            const { diluentId, vaccineId } = await newDiluent();
            const other = await newVaccine();

            const updated = await updateDiluent(diluentId, { vaccineId: other.vaccineId });
            expect(updated.status).toBe(200);
            expect(updated.body.data.vaccineId).toBe(vaccineId);
        });

    });

    describe('the cascade of ESAVI-NOTIFCN-005C', () => {

        it('dumps the diluents of the second hop in a single warn line', async () => {
            const { notificationId, vaccineId } = await newVaccine();
            const secondVaccine = await request(app)
                .post('/api/notification-vaccines')
                .set(authHeader('ADMIN'))
                .send({ notificationId, vaccineName: 'SRP' });
            const secondVaccineId = secondVaccine.body.data.vaccineId;

            const first = await createDiluent({ vaccineId, diluentName: 'A' });
            const second = await createDiluent({ vaccineId, diluentName: 'B' });
            const third = await createDiluent({ vaccineId: secondVaccineId, diluentName: 'C' });

            await deactivateNotification(notificationId);
            await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            const lines = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes('[WARN]') && line.includes('notificationDiluent row(s) dragged'));
            const own = lines.filter(line => line.includes(first.body.data.diluentId));

            expect(own).toHaveLength(1);
            expect(own[0]).toContain(second.body.data.diluentId);
            expect(own[0]).toContain(third.body.data.diluentId);
            expect(own[0]).toContain('3 notificationDiluent row(s)');

            // The lines of the older sisters keep appearing
            const vaccineLines = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes('[WARN]') && line.includes('notificationVaccine row(s) dragged') && line.includes(vaccineId));
            expect(vaccineLines).toHaveLength(1);

            expect(await NotificationDiluent.findByPk(first.body.data.diluentId, { paranoid: false })).toBeNull();
        });

        it('leaves no diluent line when the vaccines of the notification carry none', async () => {
            const { notificationId, vaccineId } = await newVaccine();

            await deactivateNotification(notificationId);
            await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            const lines = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes(vaccineId) && line.includes('notificationDiluent row(s) dragged'));

            expect(lines).toHaveLength(0);
        });

    });

});
