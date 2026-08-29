import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Notification, NonSevereNotification, Patient, SevereNotification } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine notification operations of SPEC F10. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the two
 * Postgres ENUM types, which are the first ones in the repository and must answer
 * 400 instead of letting a 22P02 surface as a 500; the death rule, which hangs on
 * the code of a catalogItem and is therefore evaluated in the service, over the
 * body on create and over the resulting state on update; the one to one relation
 * whose slot is not released by the soft delete; and the tri-state of the four
 * answerOption and boolean fields, where null is a value of its own and never
 * becomes NO_ANSWER nor false.
 */
describe('notification contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // Where purgeEntityService writes the snapshot of what it destroys, and where SPEC F13 added
    // the second dump for the row the Postgres cascade takes with it
    const logFile = path.join(__dirname, '..', '..', 'src', 'logs', 'esaviLog.log');

    // Fixtures shared by the whole file. A notification needs a case, and the death rule needs
    // the outcome catalog: the item coded DEATH is what turns the three death fields from
    // forbidden into required
    let deathItemId: string;
    let recoveredItemId: string;
    let wrongCatalogItemId: string;
    let inactiveCaseId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // Every case is minted fresh: the relation is one to one, so two tests cannot share one
    const createCaseFixture = async ( options: { isActive?: boolean } = {} ): Promise<string> => {
        const { isActive = true } = options;
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Notification ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`NT${ caseCounter }${ suffix }`),
            healthSystemCode: `NT${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `NT${ caseCounter }${ suffix }`,
            name: `Notification ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `NT-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // The outcome catalog IS seeded by esaviapp.sql, with six items whose code is the number of the
    // official catalog and whose value is the semantic key. The suite used to find-or-create its own
    // DEATH and RECOVERED keyed by code, leaving the catalog with eight items — it passed, and it
    // passed by corrupting. It now resolves the seeded rows by value and creates nothing
    const resolveOutcomeCatalog = async (): Promise<void> => {
        const items: Record<string, string> = {};
        for( const value of ['DEATH', 'RECOVERED'] ) {
            const item = await CatalogItem.findOne({
                where: { value },
                include: [{ model: CatalogType, as: 'catalogType', where: { code: 'outcome' }, attributes: [] }]
            });
            expect(item).not.toBeNull();
            items[value] = item!.getDataValue('catalogItemId');
        }
        deathItemId = items.DEATH;
        recoveredItemId = items.RECOVERED;
    };

    const tomorrow = (): string => {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        return date.toISOString().slice(0, 10);
    };

    const createNotification = ( payload: Record<string, unknown> = {}, role: TestRole = 'USER' ) =>
        request(app)
            .post('/api/notifications')
            .set(authHeader(role))
            .send({ notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose', ...payload });

    const getNotification = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notifications/${ id }`).set(authHeader(role));

    const getNotificationByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notifications/case/${ caseId }`).set(authHeader(role));

    const listNotifications = ( query: string = '', role: TestRole = 'USER' ) =>
        request(app).get(`/api/notifications${ query }`).set(authHeader(role));

    const listAdminNotifications = ( query: string = '', role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notifications/admin${ query }`).set(authHeader(role));

    const updateNotification = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/notifications/${ id }`).set(authHeader(role)).send(payload);

    const deleteNotification = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader(role));

    const activateNotification = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notifications/activate/${ id }`).set(authHeader(role));

    const purgeNotification = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notifications/purge/${ id }`).set(authHeader(role));

    // A notification over a brand new case, which is the only way to get one
    const notifyNewCase = async ( payload: Record<string, unknown> = {} ): Promise<{ id: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await createNotification({ caseId, ...payload });
        return { id: created.body.data.notificationId, caseId };
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        await resolveOutcomeCatalog();

        inactiveCaseId = await createCaseFixture({ isActive: false });

        // An item of a different catalogType, to prove the outcome check looks at the type
        const sexType = await CatalogType.findOne({ where: { code: 'sex' } });
        const sexItem = await CatalogItem.findOne({
            where: { catalogTypeId: sexType!.getDataValue('catalogTypeId') }
        });
        wrongCatalogItemId = sexItem!.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('ESAVI-NOTIFCN-001 — create', () => {

        it('creates a notification and answers 201 with the full shape', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({
                caseId,
                notificationType: 'SEVERE',
                esaviDescription: '   Anaphylaxis 20 minutes after the dose   ',
                notes: '   A note   '
            });
            const data = response.body.data;

            expect(response.status).toBe(201);
            expect(data.notificationId).toBeDefined();
            expect(data.notificationType).toBe('SEVERE');
            expect(data.esaviDescription).toBe('Anaphylaxis 20 minutes after the dose');
            expect(data.notes).toBe('A note');
            expect(data.isActive).toBe(true);
            expect(data.case).toEqual(expect.objectContaining({ caseId, eventDate: '2024-05-04' }));
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-NOTIFCN-001');
        });

        it('never exposes sysDetails nor the raw foreign keys', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId });

            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.caseId).toBeUndefined();
            expect(response.body.data.outcomeItemId).toBeUndefined();
        });

        it('stores requestInvestigation as false and the four tri-state fields as null', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId });
            const data = response.body.data;

            expect(data.requestInvestigation).toBe(false);
            expect(data.hasRelevantMedicalHistory).toBeNull();
            expect(data.takesMedication).toBeNull();
            expect(data.autopsyRequested).toBeNull();
            expect(data.verbalAutopsyPerformed).toBeNull();
            expect(data.deathDate).toBeNull();
            expect(data.outcome).toBeNull();
        });

        it('tells NO_ANSWER from null: a deliberate answer is not a missing one', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, hasRelevantMedicalHistory: 'NO_ANSWER' });

            expect(response.body.data.hasRelevantMedicalHistory).toBe('NO_ANSWER');
            expect(response.body.data.takesMedication).toBeNull();
        });

        it('answers 404 when the case does not exist', async () => {
            const response = await createNotification({ caseId: unknownUuid });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_001_CASE_NOT_FOUND');
        });

        it('answers 404 when the case is inactive: a retired case is not notified', async () => {
            const response = await createNotification({ caseId: inactiveCaseId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_001_CASE_NOT_FOUND');
        });

        it('answers 400 when caseId is missing or is not a UUID', async () => {
            const missing = await createNotification({});
            const malformed = await createNotification({ caseId: 'not-a-uuid' });

            expect(missing.status).toBe(400);
            expect(malformed.status).toBe(400);
        });

        it('answers 400 when esaviDescription is missing or blank', async () => {
            const caseId = await createCaseFixture();

            const missing = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'NON_SEVERE' });
            const blank = await createNotification({ caseId, esaviDescription: '   ' });

            expect(missing.status).toBe(400);
            expect(blank.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFCN-001 — the two Postgres ENUM', () => {

        it('answers 400 and not 500 for a notificationType outside the ENUM', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, notificationType: 'GRAVE' });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
        });

        it('answers 400 when notificationType is missing: the DDL declares it NOT NULL', async () => {
            const caseId = await createCaseFixture();

            const response = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, esaviDescription: 'No type' });

            expect(response.status).toBe(400);
        });

        it('answers 400 and not 500 for an answerOption outside the ENUM', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, hasRelevantMedicalHistory: 'MAYBE' });

            expect(response.status).toBe(400);
        });

        it('accepts both values of notificationType', async () => {
            const severe = await createNotification({ caseId: await createCaseFixture(), notificationType: 'SEVERE' });
            const nonSevere = await createNotification({ caseId: await createCaseFixture(), notificationType: 'NON_SEVERE' });

            expect(severe.status).toBe(201);
            expect(nonSevere.status).toBe(201);
        });

    });

    describe('ESAVI-NOTIFCN-001 — the death rule', () => {

        it('answers 404 for an outcome of another catalogType', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, outcomeItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_001_OUTCOME_NOT_FOUND');
        });

        it('answers 404 for an outcome that does not exist', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, outcomeItemId: unknownUuid });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_001_OUTCOME_NOT_FOUND');
        });

        it('requires deathDate and autopsyRequested when the outcome is DEATH', async () => {
            const withoutDate = await createNotification({
                caseId: await createCaseFixture(),
                outcomeItemId: deathItemId,
                autopsyRequested: true
            });
            const withoutAutopsy = await createNotification({
                caseId: await createCaseFixture(),
                outcomeItemId: deathItemId,
                deathDate: '2024-05-05'
            });

            expect(withoutDate.status).toBe(400);
            expect(withoutDate.body.code).toBe('NOTIFCN_001_DEATH_FIELDS_REQUIRED');
            expect(withoutAutopsy.status).toBe(400);
            expect(withoutAutopsy.body.code).toBe('NOTIFCN_001_DEATH_FIELDS_REQUIRED');
        });

        it('accepts a DEATH outcome without verbalAutopsyPerformed: the third field is always optional', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({
                caseId,
                outcomeItemId: deathItemId,
                deathDate: '2024-05-05',
                autopsyRequested: true
            });

            expect(response.status).toBe(201);
            expect(response.body.data.deathDate).toBe('2024-05-05');
            expect(response.body.data.autopsyRequested).toBe(true);
            expect(response.body.data.verbalAutopsyPerformed).toBeNull();
            // The seeded item is code '5', name 'Fallecido', value 'DEATH': it is the value that
            // fires the death rule since SPEC F46, and the code is the country's to change
            expect(response.body.data.outcome).toEqual(expect.objectContaining({ value: 'DEATH' }));
        });

        it('rejects each of the three death fields when the outcome is not DEATH', async () => {
            const withDate = await createNotification({
                caseId: await createCaseFixture(),
                outcomeItemId: recoveredItemId,
                deathDate: '2024-05-05'
            });
            const withAutopsy = await createNotification({
                caseId: await createCaseFixture(),
                outcomeItemId: recoveredItemId,
                autopsyRequested: true
            });
            const withVerbalAutopsy = await createNotification({
                caseId: await createCaseFixture(),
                outcomeItemId: recoveredItemId,
                verbalAutopsyPerformed: false
            });

            for( const response of [withDate, withAutopsy, withVerbalAutopsy] ) {
                expect(response.status).toBe(400);
                expect(response.body.code).toBe('NOTIFCN_001_DEATH_FIELDS_NOT_ALLOWED');
            }
        });

        it('rejects the death fields when no outcome travels at all', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({ caseId, deathDate: '2024-05-05' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFCN_001_DEATH_FIELDS_NOT_ALLOWED');
        });

        it('answers 400 from the validator for a future deathDate', async () => {
            const caseId = await createCaseFixture();

            const response = await createNotification({
                caseId,
                outcomeItemId: deathItemId,
                deathDate: tomorrow(),
                autopsyRequested: true
            });

            expect(response.status).toBe(400);
            expect(response.body.code).not.toBe('NOTIFCN_001_DEATH_FIELDS_REQUIRED');
        });

    });

    describe('ESAVI-NOTIFCN-001 — one to one with the case', () => {

        it('answers 409 with the caseId in the message when the case is already notified', async () => {
            const { caseId } = await notifyNewCase();

            const response = await createNotification({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFCN_001_CASE_ALREADY_NOTIFIED');
            expect(response.body.message).toContain(caseId);
        });

        it('answers 409 as well when the existing notification is inactive: the slot is not released', async () => {
            const { id, caseId } = await notifyNewCase();
            await deleteNotification(id);

            const response = await createNotification({ caseId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFCN_001_CASE_ALREADY_NOTIFIED');
        });

    });

    describe('ESAVI-NOTIFCN-002A / 002B — listings', () => {

        it('hides the inactive ones in the public listing and shows them in the admin one', async () => {
            const { id, caseId } = await notifyNewCase();
            await deleteNotification(id);

            const publicList = await listNotifications(`?caseId=${ caseId }`);
            const adminList = await listAdminNotifications(`?caseId=${ caseId }`);

            expect(publicList.body.data.count).toBe(0);
            expect(adminList.body.data.count).toBe(1);
            expect(adminList.body.data.rows[0].notificationId).toBe(id);
        });

        it('a USER gets 403 on the admin listing', async () => {
            const response = await listAdminNotifications('', 'USER');

            expect(response.status).toBe(403);
        });

        it('returns the reduced shape: esaviDescription travels, notes and the timestamps do not', async () => {
            const { caseId } = await notifyNewCase({ notes: 'Not in the listing' });

            const response = await listNotifications(`?caseId=${ caseId }`);
            const row = response.body.data.rows[0];

            expect(row.esaviDescription).toBe('Fever after the dose');
            expect(row.notes).toBeUndefined();
            expect(row.appDetails).toBeUndefined();
            expect(row.createdAt).toBeUndefined();
            expect(row.updatedAt).toBeUndefined();
            expect(row.deletedAt).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
        });

        it('filters by notificationType and answers 400 for a value outside the ENUM', async () => {
            const { caseId } = await notifyNewCase({ notificationType: 'SEVERE' });

            const matching = await listNotifications(`?caseId=${ caseId }&notificationType=SEVERE`);
            const notMatching = await listNotifications(`?caseId=${ caseId }&notificationType=NON_SEVERE`);
            const malformed = await listNotifications('?notificationType=X');

            expect(matching.body.data.count).toBe(1);
            expect(notMatching.body.data.count).toBe(0);
            expect(malformed.status).toBe(400);
        });

        it('filters by requestInvestigation and by outcomeItemId, accumulating with AND', async () => {
            const { caseId } = await notifyNewCase({ requestInvestigation: true, outcomeItemId: recoveredItemId });

            const all = await listNotifications(
                `?caseId=${ caseId }&requestInvestigation=true&outcomeItemId=${ recoveredItemId }&notificationType=NON_SEVERE`
            );
            const oneOff = await listNotifications(`?caseId=${ caseId }&requestInvestigation=false`);

            expect(all.body.data.count).toBe(1);
            expect(oneOff.body.data.count).toBe(0);
        });

        it('answers 200 with an empty page for a foreign key that does not exist', async () => {
            const response = await listNotifications(`?caseId=${ unknownUuid }`);

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
            expect(response.body.data.rows).toEqual([]);
        });

        it('paginates without losing the total count', async () => {
            await notifyNewCase();
            await notifyNewCase();

            const response = await listNotifications('?limit=2');

            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.count).toBeGreaterThanOrEqual(2);
        });

        it('answers 400 for a malformed filter', async () => {
            const response = await listNotifications('?caseId=not-a-uuid');

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFCN-003 — get by id', () => {

        it('returns the full shape', async () => {
            const { id, caseId } = await notifyNewCase({ notes: 'Visible here' });

            const response = await getNotification(id);

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Visible here');
            expect(response.body.data.case.caseId).toBe(caseId);
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        it('answers 404 for an unknown id', async () => {
            const response = await getNotification(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_003_NOT_FOUND');
        });

        it('hides an inactive notification from USER and ADMIN and shows it to SUPERADMIN', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const asUser = await getNotification(id, 'USER');
            const asAdmin = await getNotification(id, 'ADMIN');
            const asSuperAdmin = await getNotification(id, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asAdmin.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.isActive).toBe(false);
        });

        it('does not capture the literal paths as an :id', async () => {
            const admin = await listAdminNotifications();
            const malformed = await getNotification('not-a-uuid');

            expect(admin.status).toBe(200);
            expect(malformed.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFCN-006 — get by case', () => {

        it('returns the record itself and not a collection', async () => {
            const { id, caseId } = await notifyNewCase({ notes: 'By case' });

            const response = await getNotificationByCase(caseId);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(false);
            expect(response.body.data.count).toBeUndefined();
            expect(response.body.data.rows).toBeUndefined();
            expect(response.body.data.notificationId).toBe(id);
            expect(response.body.data.notes).toBe('By case');
        });

        it('tells an unknown case from a case with no notification', async () => {
            const unnotified = await createCaseFixture();

            const unknownCase = await getNotificationByCase(unknownUuid);
            const noNotification = await getNotificationByCase(unnotified);

            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('NOTIFCN_006_CASE_NOT_FOUND');
            expect(noNotification.status).toBe(404);
            expect(noNotification.body.code).toBe('NOTIFCN_006_NOT_FOUND');
        });

        it('hides an inactive notification from USER and shows it to SUPERADMIN', async () => {
            const { id, caseId } = await notifyNewCase();
            await deleteNotification(id);

            const asUser = await getNotificationByCase(caseId, 'USER');
            const asSuperAdmin = await getNotificationByCase(caseId, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
        });

        it('answers 400 when the caseId is not a UUID', async () => {
            const response = await getNotificationByCase('not-a-uuid');

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFCN-004 — update', () => {

        it('updates the free texts, trims them and preserves the audit trail', async () => {
            const { id } = await notifyNewCase({ notes: 'Original' });

            const response = await updateNotification(id, { notes: '   Corrected   ' });

            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Corrected');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-NOTIFCN-001');
            expect(response.body.data.appDetails[1].method).toBe('ESAVI-NOTIFCN-004');
            expect(response.body.data.updatedAt).not.toBeNull();
        });

        it('ignores caseId: the notification stays on its case', async () => {
            const { id, caseId } = await notifyNewCase();
            const otherCaseId = await createCaseFixture();

            const response = await updateNotification(id, { caseId: otherCaseId });

            expect(response.status).toBe(200);
            expect(response.body.data.case.caseId).toBe(caseId);
        });

        it('ignores notificationType, with no error', async () => {
            const { id } = await notifyNewCase({ notificationType: 'SEVERE' });

            const response = await updateNotification(id, { notificationType: 'NON_SEVERE' });

            expect(response.status).toBe(200);
            expect(response.body.data.notificationType).toBe('SEVERE');
        });

        it('answers 400 when esaviDescription is left blank', async () => {
            const { id } = await notifyNewCase();

            const response = await updateNotification(id, { esaviDescription: '   ' });

            expect(response.status).toBe(400);
        });

        it('leaves requestInvestigation alone when the body does not mention it', async () => {
            const { id } = await notifyNewCase({ requestInvestigation: true });

            const response = await updateNotification(id, { notes: 'Untouched' });

            expect(response.body.data.requestInvestigation).toBe(true);
        });

        it('writes nothing when the PUT carries no change', async () => {
            const { id } = await notifyNewCase({ notes: 'Sin novedad' });
            const before = await getNotification(id);

            const empty = await updateNotification(id, {});
            const identical = await updateNotification(id, { notes: 'Sin novedad', requestInvestigation: false });

            expect(empty.status).toBe(200);
            expect(identical.status).toBe(200);
            expect(identical.body.data.appDetails).toHaveLength(1);
            expect(identical.body.data.appDetails[0].method).toBe('ESAVI-NOTIFCN-001');
            expect(identical.body.data.updatedAt).toBe(before.body.data.updatedAt);
        });

        it('writes only the field that actually changed', async () => {
            const { id } = await notifyNewCase({ notes: 'First' });
            const before = await getNotification(id);

            const response = await updateNotification(id, { esaviDescription: 'Fever after the dose', notes: 'Second' });

            expect(response.body.data.notes).toBe('Second');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.updatedAt).not.toBe(before.body.data.updatedAt);
        });

        it('answers 404 for an unknown id', async () => {
            const response = await updateNotification(unknownUuid, {});

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_004_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFCN-004 — the death rule over the resulting state', () => {

        const notifyWithDeath = () => notifyNewCase({
            outcomeItemId: deathItemId,
            deathDate: '2024-05-05',
            autopsyRequested: true,
            verbalAutopsyPerformed: false
        });

        it('rejects moving the outcome away from DEATH without clearing the three fields', async () => {
            const { id } = await notifyWithDeath();

            const response = await updateNotification(id, { outcomeItemId: recoveredItemId });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFCN_004_DEATH_FIELDS_NOT_ALLOWED');
        });

        it('accepts the same move when the three fields travel as null', async () => {
            const { id } = await notifyWithDeath();

            const response = await updateNotification(id, {
                outcomeItemId: recoveredItemId,
                deathDate: null,
                autopsyRequested: null,
                verbalAutopsyPerformed: null
            });

            expect(response.status).toBe(200);
            expect(response.body.data.outcome.value).toBe('RECOVERED');
            expect(response.body.data.deathDate).toBeNull();
            expect(response.body.data.autopsyRequested).toBeNull();
            expect(response.body.data.verbalAutopsyPerformed).toBeNull();
        });

        it('rejects moving the outcome to DEATH without sending the two required fields', async () => {
            const { id } = await notifyNewCase();

            const response = await updateNotification(id, { outcomeItemId: deathItemId });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFCN_004_DEATH_FIELDS_REQUIRED');
        });

        it('accepts that same move when both required fields travel with it', async () => {
            const { id } = await notifyNewCase();

            const response = await updateNotification(id, {
                outcomeItemId: deathItemId,
                deathDate: '2024-05-06',
                autopsyRequested: false
            });

            expect(response.status).toBe(200);
            expect(response.body.data.deathDate).toBe('2024-05-06');
            expect(response.body.data.autopsyRequested).toBe(false);
        });

        it('rejects clearing a required death field while the outcome stays DEATH', async () => {
            const { id } = await notifyWithDeath();

            const response = await updateNotification(id, { deathDate: null });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFCN_004_DEATH_FIELDS_REQUIRED');
        });

        it('answers 404 for an outcome of another catalogType', async () => {
            const { id } = await notifyNewCase();

            const response = await updateNotification(id, { outcomeItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_004_OUTCOME_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFCN-005A / 005B — deactivate and reactivate', () => {

        it('deactivating seals isActive and deletedAt and answers without data', async () => {
            const { id } = await notifyNewCase();

            const response = await deleteNotification(id);
            const stored = await Notification.findByPk(id);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(stored!.getDataValue('isActive')).toBe(false);
            expect(stored!.getDataValue('deletedAt')).not.toBeNull();
        });

        it('deactivating twice answers 409', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const response = await deleteNotification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFCN_005A_ALREADY_INACTIVE');
        });

        it('reactivating clears deletedAt and records the three codes in order', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const response = await activateNotification(id);
            const stored = await Notification.findByPk(id);
            const appDetails = stored!.getDataValue('appDetails') as { method: string }[];

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(stored!.getDataValue('deletedAt')).toBeNull();
            expect(appDetails.map((entry) => entry.method))
                .toEqual(['ESAVI-NOTIFCN-001', 'ESAVI-NOTIFCN-005A', 'ESAVI-NOTIFCN-005B']);
        });

        it('reactivating an active one answers 409', async () => {
            const { id } = await notifyNewCase();

            const response = await activateNotification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFCN_005B_ALREADY_ACTIVE');
        });

        it('an ADMIN gets 403 on activate', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const response = await activateNotification(id, 'ADMIN');

            expect(response.status).toBe(403);
        });

        it('reactivating does not require the case to be active', async () => {
            const { id, caseId } = await notifyNewCase();
            await deleteNotification(id);
            await EsaviCase.update({ isActive: false }, { where: { caseId } });

            const response = await activateNotification(id);

            expect(response.status).toBe(200);
        });

        it('answers 404 for an unknown id', async () => {
            const response = await deleteNotification(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_005A_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFCN-005C — purge', () => {

        it('answers 409 on an active notification and the row survives', async () => {
            const { id } = await notifyNewCase();

            const response = await purgeNotification(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFCN_005C_STILL_ACTIVE');
            expect(await Notification.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('destroys an inactive one and answers 200 without data', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const response = await purgeNotification(id);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(await Notification.findByPk(id, { paranoid: false })).toBeNull();
        });

        it('answers 404 when the purge is repeated', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);
            await purgeNotification(id);

            const response = await purgeNotification(id);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFCN_005C_NOT_FOUND');
        });

        it('an ADMIN gets 403', async () => {
            const { id } = await notifyNewCase();
            await deleteNotification(id);

            const response = await purgeNotification(id, 'ADMIN');

            expect(response.status).toBe(403);
            expect(await Notification.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('releases the caseId, which is the only way to get it back', async () => {
            const { id, caseId } = await notifyNewCase();
            await deleteNotification(id);

            const blocked = await createNotification({ caseId });
            await purgeNotification(id);
            const allowed = await createNotification({ caseId });

            expect(blocked.status).toBe(409);
            expect(allowed.status).toBe(201);
        });

        it('does not alter the case the notification belonged to', async () => {
            const { id, caseId } = await notifyNewCase();
            const before = await EsaviCase.findByPk(caseId);
            await deleteNotification(id);

            await purgeNotification(id);

            const after = await EsaviCase.findByPk(caseId);
            expect(after).not.toBeNull();
            expect(after!.getDataValue('caseCode')).toBe(before!.getDataValue('caseCode'));
            expect(after!.getDataValue('isActive')).toBe(true);
        });

    });

    // SPEC F13 hung the first of the eight satellites from this entity, and with it three side
    // effects on operations this suite already covered. The detail has no isActive of its own —
    // its lifecycle is governed here — so what 005A and 005B move is its deletedAt, and 005C
    // destroys it through the ON DELETE CASCADE of the DDL without this service deleting anything
    describe('the severe detail hanging from the notification', () => {

        // A SEVERE notification with its detail: the default type of the fixture is NON_SEVERE,
        // which does not admit one
        const notifyWithSevereDetail = async (): Promise<string> => {
            const { id } = await notifyNewCase({ notificationType: 'SEVERE' });
            await request(app).post('/api/severe-notifications').set(authHeader('USER'))
                .send({ notificationId: id });
            return id;
        };

        const readDetail = async ( id: string ) => {
            const row = await SevereNotification.findByPk(id);
            return {
                deletedAt: row!.getDataValue('deletedAt') as Date | null,
                appDetails: row!.getDataValue('appDetails') as { method: string }[]
            };
        };

        it('005A seals the deletedAt of the detail and records who dragged it', async () => {
            const id = await notifyWithSevereDetail();
            expect(( await readDetail(id) ).deletedAt).toBeNull();

            const response = await deleteNotification(id);

            expect(response.status).toBe(200);
            const detail = await readDetail(id);
            expect(detail.deletedAt).not.toBeNull();
            expect(detail.appDetails).toHaveLength(2);
            expect(detail.appDetails[1].method).toBe('ESAVI-NOTIFCN-005A');
        });

        it('005B clears it again, which is what keeps the round trip a round trip', async () => {
            const id = await notifyWithSevereDetail();
            await deleteNotification(id);

            const response = await activateNotification(id);

            expect(response.status).toBe(200);
            const detail = await readDetail(id);
            expect(detail.deletedAt).toBeNull();
            expect(detail.appDetails.map(entry => entry.method))
                .toEqual(['ESAVI-SEVNOT-001', 'ESAVI-NOTIFCN-005A', 'ESAVI-NOTIFCN-005B']);
        });

        it('a detail already sealed keeps its original date and gets no new entry', async () => {
            const id = await notifyWithSevereDetail();
            await deleteNotification(id);
            const sealed = await readDetail(id);

            // Back to active, then sealed by hand so the second deactivation finds it that way
            await activateNotification(id);
            await SevereNotification.update({ deletedAt: sealed.deletedAt }, { where: { notificationId: id } });
            const before = await readDetail(id);

            await deleteNotification(id);

            const after = await readDetail(id);
            expect(after.deletedAt).toEqual(before.deletedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('a notification with no detail drags nothing and does not fail', async () => {
            const { id } = await notifyNewCase({ notificationType: 'SEVERE' });

            expect(( await deleteNotification(id) ).status).toBe(200);
            expect(( await activateNotification(id) ).status).toBe(200);
            expect(await SevereNotification.findByPk(id)).toBeNull();
        });

        it('005C leaves two dumps in the log and the cascade destroys both rows', async () => {
            const id = await notifyWithSevereDetail();
            await deleteNotification(id);

            const response = await purgeNotification(id);
            expect(response.status).toBe(200);

            const dumps = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes(id) && line.includes('Snapshot:'));
            expect(dumps).toHaveLength(2);
            expect(dumps.filter(line => line.includes('severeNotification row dragged'))).toHaveLength(1);
            expect(dumps.every(line => line.includes('[WARN]'))).toBe(true);

            expect(await Notification.findByPk(id, { paranoid: false })).toBeNull();
            expect(await SevereNotification.findByPk(id)).toBeNull();
        });

        it('005C on a notification without detail leaves a single dump, as it always did', async () => {
            const { id } = await notifyNewCase({ notificationType: 'SEVERE' });
            await deleteNotification(id);

            await purgeNotification(id);

            const dumps = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes(id) && line.includes('Snapshot:'));
            expect(dumps).toHaveLength(1);
        });

    });

    // SPEC F14 hung the second satellite from this entity, with the same three side effects and
    // the same mechanism. What this block has to prove beyond the one above is that the two
    // branches stay separate: a notification carries at most one of them, because notificationType
    // is unique per row, so the cascade that does not apply must find zero rows silently and the
    // 005C dump must stay at two entries and never reach three
    describe('the non severe detail hanging from the notification', () => {

        // The default type of the fixture is NON_SEVERE, which is the one that admits this detail
        const notifyWithNonSevereDetail = async (): Promise<string> => {
            const { id } = await notifyNewCase({ notificationType: 'NON_SEVERE' });
            await request(app).post('/api/non-severe-notifications').set(authHeader('USER'))
                .send({ notificationId: id });
            return id;
        };

        const readDetail = async ( id: string ) => {
            const row = await NonSevereNotification.findByPk(id);
            return {
                deletedAt: row!.getDataValue('deletedAt') as Date | null,
                appDetails: row!.getDataValue('appDetails') as { method: string }[]
            };
        };

        it('005A seals the deletedAt of the detail and records who dragged it', async () => {
            const id = await notifyWithNonSevereDetail();
            expect(( await readDetail(id) ).deletedAt).toBeNull();

            const response = await deleteNotification(id);

            expect(response.status).toBe(200);
            const detail = await readDetail(id);
            expect(detail.deletedAt).not.toBeNull();
            expect(detail.appDetails).toHaveLength(2);
            expect(detail.appDetails[1].method).toBe('ESAVI-NOTIFCN-005A');
        });

        it('005B clears it again, which is what keeps the round trip a round trip', async () => {
            const id = await notifyWithNonSevereDetail();
            await deleteNotification(id);

            const response = await activateNotification(id);

            expect(response.status).toBe(200);
            const detail = await readDetail(id);
            expect(detail.deletedAt).toBeNull();
            expect(detail.appDetails.map(entry => entry.method))
                .toEqual(['ESAVI-NSEVNOT-001', 'ESAVI-NOTIFCN-005A', 'ESAVI-NOTIFCN-005B']);
        });

        it('a detail already sealed keeps its original date and gets no new entry', async () => {
            const id = await notifyWithNonSevereDetail();
            await deleteNotification(id);
            const sealed = await readDetail(id);

            // Back to active, then sealed by hand so the second deactivation finds it that way
            await activateNotification(id);
            await NonSevereNotification.update({ deletedAt: sealed.deletedAt }, { where: { notificationId: id } });
            const before = await readDetail(id);

            await deleteNotification(id);

            const after = await readDetail(id);
            expect(after.deletedAt).toEqual(before.deletedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('a NON_SEVERE notification with no detail drags nothing and does not fail', async () => {
            const { id } = await notifyNewCase({ notificationType: 'NON_SEVERE' });

            expect(( await deleteNotification(id) ).status).toBe(200);
            expect(( await activateNotification(id) ).status).toBe(200);
            expect(await NonSevereNotification.findByPk(id)).toBeNull();
        });

        it('a SEVERE notification does not touch the non severe branch at all', async () => {
            const { id } = await notifyNewCase({ notificationType: 'SEVERE' });
            await request(app).post('/api/severe-notifications').set(authHeader('USER'))
                .send({ notificationId: id });

            // The branch that does not apply finds zero rows, which is not an error
            expect(( await deleteNotification(id) ).status).toBe(200);
            expect(( await activateNotification(id) ).status).toBe(200);
            expect(await NonSevereNotification.findByPk(id)).toBeNull();
            expect(await SevereNotification.findByPk(id)).not.toBeNull();
        });

        it('005C leaves two dumps and not three, and the cascade destroys both rows', async () => {
            const id = await notifyWithNonSevereDetail();
            await deleteNotification(id);

            const response = await purgeNotification(id);
            expect(response.status).toBe(200);

            const dumps = fs.readFileSync(logFile, 'utf8')
                .split('\n')
                .filter(line => line.includes(id) && line.includes('Snapshot:'));
            expect(dumps).toHaveLength(2);
            expect(dumps.filter(line => line.includes('nonSevereNotification row dragged'))).toHaveLength(1);
            // The other branch left nothing behind: the two are mutually exclusive
            expect(dumps.filter(line => line.includes(' severeNotification row dragged'))).toHaveLength(0);
            expect(dumps.every(line => line.includes('[WARN]'))).toBe(true);

            expect(await Notification.findByPk(id, { paranoid: false })).toBeNull();
            expect(await NonSevereNotification.findByPk(id)).toBeNull();
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const caseId = await createCaseFixture();
            const created = await createNotification({
                caseId,
                notificationType: 'SEVERE',
                hasRelevantMedicalHistory: 'YES',
                takesMedication: 'NO_ANSWER',
                outcomeItemId: deathItemId,
                deathDate: '2024-05-05',
                autopsyRequested: true,
                requestInvestigation: true,
                notes: 'Sin novedad'
            });
            expect(created.status).toBe(201);

            // Nothing is stripped: the response carries the resolved `outcome` object instead of
            // outcomeItemId, so resending it verbatim leaves the outcome untouched and the death
            // rule reads the stored one
            await expectPutOfGetResponseWritesNothing({
                path: '/api/notifications',
                id: created.body.data.notificationId,
                model: Notification
            });
        });

    });

});
