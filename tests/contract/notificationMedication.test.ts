import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, HealthFacility, Notification, NotificationMedication, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine notificationMedication operations of SPEC F21. It walks
 * the entity end to end — create, read by id, list by notification, admin list, list by
 * case, update, deactivate, reactivate, purge — and covers what cannot be checked by
 * hand reliably.
 *
 * This is the fourth satellite of notification and the second one to many, so it
 * inherits the sortOrder collision F16 already faced: the partial unique index is
 * conditioned by deletedAt, so a 005A frees the number, a later create reuses it, and
 * reactivating the old row would blow the index up. The suite runs those four movements
 * literally and expects the reactivated medication at the end of the list.
 *
 * What is new here is the pair of catalog keys nothing in the database validates. Both
 * must exist, be active and belong to their own catalogType on write, and neither is
 * filtered by isActive on read — an item retired after the record was written still
 * describes how the medication was given.
 *
 * The third axis is the differential update, which in this entity is the clean case of
 * F12: eight candidates, all compared against what is stored, none derived.
 */
describe('notificationMedication contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // The data preconditions the spec declares: an item of each of the two catalogs, an
    // inactive one, and an active item of a third catalog — a valid UUID pointing at a
    // meaningless form
    let formItemId: string;
    let routeItemId: string;
    let inactiveRouteItemId: string;
    let otherCatalogItemId: string;

    // Both catalogTypes are seeded by esaviapp.sql itself, so they are looked up and never
    // created: creating them again would collide with the unique code
    const itemOfCatalog = async ( code: string, itemCode: string, isActive: boolean = true ): Promise<string> => {
        const catalogType = await CatalogType.findOne({ where: { code } });
        const item = await CatalogItem.create({
            catalogTypeId: catalogType!.getDataValue('catalogTypeId'),
            code: itemCode,
            name: itemCode,
            value: itemCode,
            isActive
        });
        return item.getDataValue('catalogItemId');
    };

    const createCaseFixture = async (): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Medication ${ caseCounter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`MD${ caseCounter }${ suffix }`),
            healthSystemCode: `MD${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `MD${ caseCounter }${ suffix }`,
            name: `Medication ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `MD-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification over a brand new case. The concomitant medication is asked the same way
    // whether the notification is severe or not, so the type is fixed and never a fixture knob
    const notifyNewCase = async (): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createMedication = ( payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).post('/api/notification-medications').set(authHeader(role)).send(payload);

    const getMedication = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-medications/${ id }`).set(authHeader(role));

    const listByNotification = ( notificationId: string, role: TestRole = 'USER', query: string = '' ) =>
        request(app).get(`/api/notification-medications/notification/${ notificationId }${ query }`).set(authHeader(role));

    const listAllByNotification = ( notificationId: string, role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notification-medications/admin/notification/${ notificationId }`).set(authHeader(role));

    const listByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-medications/case/${ caseId }`).set(authHeader(role));

    const updateMedication = ( id: string, payload: Record<string, unknown>, role: TestRole = 'ADMIN' ) =>
        request(app).put(`/api/notification-medications/${ id }`).set(authHeader(role)).send(payload);

    const deleteMedication = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notification-medications/${ id }`).set(authHeader(role));

    const activateMedication = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notification-medications/activate/${ id }`).set(authHeader(role));

    const purgeMedication = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notification-medications/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new medication over its own notification, ready to be read or updated
    const newMedication = async ( payload: Record<string, unknown> = {} ): Promise<{ medicationId: string, notificationId: string, caseId: string }> => {
        const { notificationId, caseId } = await notifyNewCase();
        const created = await createMedication({ notificationId, medicationName: 'Ibuprofeno', ...payload });
        return { medicationId: created.body.data.medicationId, notificationId, caseId };
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NotificationMedication.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const sortOrders = async ( notificationId: string ): Promise<number[]> => {
        const rows = await NotificationMedication.findAll({
            where: { notificationId },
            order: [[ 'sortOrder', 'ASC' ]]
        });
        return rows.map(row => row.getDataValue('sortOrder') as number);
    };

    const storedSortOrder = async ( id: string ): Promise<number> => {
        const row = await NotificationMedication.findByPk(id);
        return row!.getDataValue('sortOrder') as number;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        formItemId = await itemOfCatalog('pharmaceuticalForm', `TABLET_${ suffix }`);
        routeItemId = await itemOfCatalog('administrationRoute', `ORAL_${ suffix }`);
        inactiveRouteItemId = await itemOfCatalog('administrationRoute', `RETIRED_${ suffix }`, false);

        // An active item of another catalogType: a valid UUID pointing at a meaningless form
        const otherType = await CatalogType.create({ code: `otherCatalog${ suffix }`, name: `Other ${ suffix }` });
        const otherItem = await CatalogItem.create({
            catalogTypeId: otherType.getDataValue('catalogTypeId'),
            code: `OTHER_${ suffix }`,
            name: `Other ${ suffix }`,
            value: `Other ${ suffix }`
        });
        otherCatalogItemId = otherItem.getDataValue('catalogItemId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the walkthrough', () => {

        it('goes create -> get -> list -> admin list -> by case -> update -> deactivate -> reactivate -> purge', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            // Create
            const created = await createMedication({
                notificationId,
                medicationName: 'Ibuprofeno',
                dose: '400 mg cada 8 h',
                pharmaceuticalFormItemId: formItemId,
                administrationRouteItemId: routeItemId
            });
            expect(created.status).toBe(201);
            expect(created.body.data.sortOrder).toBe(1);
            const medicationId = created.body.data.medicationId;

            // Get by id
            expect(( await getMedication(medicationId) ).status).toBe(200);

            // List by notification, admin list and list by case
            expect(( await listByNotification(notificationId) ).body.data.count).toBe(1);
            expect(( await listAllByNotification(notificationId) ).body.data.count).toBe(1);
            const byCase = await listByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.rows[0].notificationId).toBe(notificationId);

            // Update
            const updated = await updateMedication(medicationId, { dose: '600 mg cada 8 h' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.dose).toBe('600 mg cada 8 h');

            // Purging before the retirement is refused: two deliberate steps are the safety net
            expect(( await purgeMedication(medicationId) ).status).toBe(409);

            // Deactivate and reactivate
            expect(( await deleteMedication(medicationId) ).status).toBe(200);
            expect(( await activateMedication(medicationId) ).status).toBe(200);

            // Purge
            expect(( await deleteMedication(medicationId) ).status).toBe(200);
            expect(( await purgeMedication(medicationId) ).status).toBe(200);
            expect(await NotificationMedication.findByPk(medicationId)).toBeNull();
        });

    });

    describe('ESAVI-NOTIFMED-001 — create', () => {

        it('resolves both catalog items and normalizes the texts', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: '  ibuprofeno GENÉRICO  ',
                medicationCode: '  ABC-123  ',
                dose: '  400 mg  ',
                pharmaceuticalFormItemId: formItemId,
                administrationRouteItemId: routeItemId,
                startDate: '2024-05-01'
            });

            expect(response.status).toBe(201);
            const data = response.body.data;
            // toTitleCase over the name, plain trim over the code: the hyphen survives
            expect(data.medicationName).toBe('Ibuprofeno Genérico');
            expect(data.medicationCode).toBe('ABC-123');
            expect(data.dose).toBe('400 mg');
            expect(data.startDate).toBe('2024-05-01');
            expect(data.pharmaceuticalForm.catalogItemId).toBe(formItemId);
            expect(data.administrationRoute.catalogItemId).toBe(routeItemId);
            // Three fields and no more: sortOrder, value and catalogTypeId are governance
            expect(Object.keys(data.pharmaceuticalForm).sort()).toEqual([ 'catalogItemId', 'code', 'name' ]);
            // The raw keys travel next to the resolved objects, so a PUT can resend the GET
            expect(data.pharmaceuticalFormItemId).toBe(formItemId);
            expect(data.administrationRouteItemId).toBe(routeItemId);
            expect(data).not.toHaveProperty('sysDetails');
            expect(data).not.toHaveProperty('notification');
            expect(await auditMethods(data.medicationId)).toEqual([ 'ESAVI-NOTIFMED-001' ]);
        });

        it('accepts a medication with neither catalog key and resolves both to null', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({ notificationId, medicationName: 'Paracetamol' });

            expect(response.status).toBe(201);
            expect(response.body.data.pharmaceuticalForm).toBeNull();
            expect(response.body.data.administrationRoute).toBeNull();
            expect(response.body.data.isOtherMedication).toBe(false);
        });

        it('answers 404 for a catalogItem outside the pharmaceuticalForm catalog', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'Ibuprofeno',
                pharmaceuticalFormItemId: otherCatalogItemId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFMED_001_PHARMACEUTICAL_FORM_NOT_FOUND');
        });

        it('answers 404 for an inactive item of the administrationRoute catalog', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'Ibuprofeno',
                administrationRouteItemId: inactiveRouteItemId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFMED_001_ADMINISTRATION_ROUTE_NOT_FOUND');
        });

        it('answers 404 over an unknown or inactive notification', async () => {
            const unknown = await createMedication({ notificationId: unknownUuid, medicationName: 'Ibuprofeno' });
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('NOTIFMED_001_NOTIFICATION_NOT_FOUND');

            const { notificationId } = await notifyNewCase();
            await deactivateNotification(notificationId);
            const retired = await createMedication({ notificationId, medicationName: 'Ibuprofeno' });
            expect(retired.status).toBe(404);
            expect(retired.body.code).toBe('NOTIFMED_001_NOTIFICATION_NOT_FOUND');
        });

        it('lets the trigger assign 1, 2 and 3 without any service sending the field', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createMedication({ notificationId, medicationName: name });
            }

            expect(await sortOrders(notificationId)).toEqual([ 1, 2, 3 ]);
        });

        it('ignores a sortOrder sent in the body instead of answering 400', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({ notificationId, medicationName: 'Ibuprofeno', sortOrder: 99 });

            expect(response.status).toBe(201);
            expect(response.body.data.sortOrder).toBe(1);
        });

        it('answers 400 for a medicationName longer than the column', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'x'.repeat(251)
            });

            expect(response.status).toBe(400);
        });

    });

    describe('the coherence rule of the "other" medication', () => {

        it('answers 400 when isOtherMedication is true and no text travels', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'Jarabe casero',
                isOtherMedication: true
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFMED_001_OTHER_TEXT_REQUIRED');
        });

        it('answers 400 for a text without isOtherMedication', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'Ibuprofeno',
                otherMedicationText: 'algo'
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFMED_001_OTHER_TEXT_NOT_ALLOWED');
        });

        // The prohibition F16 declares over esaviCode does not apply here: medicationCode
        // enters no master, so a medication missing from the form may perfectly well carry
        // the code printed on its box
        it('accepts a medicationCode next to isOtherMedication true', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createMedication({
                notificationId,
                medicationName: 'Jarabe casero',
                medicationCode: 'XYZ-9',
                isOtherMedication: true,
                otherMedicationText: 'Preparado del herbolario'
            });

            expect(response.status).toBe(201);
            expect(response.body.data.medicationCode).toBe('XYZ-9');
        });

        // The rule is evaluated over the resulting state and not over the body, or it could be
        // evaded by splitting the two fields into two requests
        it('answers 400 for a PUT that only sends the text over a row with isOtherMedication false', async () => {
            const { medicationId } = await newMedication();
            const response = await updateMedication(medicationId, { otherMedicationText: 'algo' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFMED_004_OTHER_TEXT_NOT_ALLOWED');
        });

    });

    describe('ESAVI-NOTIFMED-002A / 002B — the two listings', () => {

        it('orders by sortOrder and drops what a 005A retired', async () => {
            const { notificationId } = await notifyNewCase();
            const ids: string[] = [];
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                const created = await createMedication({ notificationId, medicationName: name });
                ids.push(created.body.data.medicationId);
            }
            await deleteMedication(ids[1]);

            const active = await listByNotification(notificationId);
            expect(active.body.data.count).toBe(2);
            expect(active.body.data.rows.map(( row: { sortOrder: number } ) => row.sortOrder)).toEqual([ 1, 3 ]);

            // The admin listing is the only door to the retired row
            const all = await listAllByNotification(notificationId);
            expect(all.body.data.count).toBe(3);
            expect(all.body.data.rows.map(( row: { sortOrder: number } ) => row.sortOrder)).toEqual([ 1, 2, 3 ]);
        });

        it('answers 404 over a retired notification and 200 for a SUPERADMIN', async () => {
            const { notificationId } = await notifyNewCase();
            await createMedication({ notificationId, medicationName: 'Ibuprofeno' });
            await deactivateNotification(notificationId);

            expect(( await listByNotification(notificationId, 'USER') ).status).toBe(404);
            expect(( await listAllByNotification(notificationId, 'ADMIN') ).status).toBe(404);
            expect(( await listByNotification(notificationId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('refuses the admin listing to a USER', async () => {
            const { notificationId } = await notifyNewCase();

            expect(( await listAllByNotification(notificationId, 'USER') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFMED-003 — get by id', () => {

        it('answers 404 for a medication whose notification was retired, and 200 for a SUPERADMIN', async () => {
            const { medicationId, notificationId } = await newMedication();
            await deactivateNotification(notificationId);

            expect(( await getMedication(medicationId, 'USER') ).status).toBe(404);
            expect(( await getMedication(medicationId, 'ADMIN') ).status).toBe(404);
            expect(( await getMedication(medicationId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 404 for a retired medication, and 200 for a SUPERADMIN', async () => {
            const { medicationId } = await newMedication();
            await deleteMedication(medicationId);

            const hidden = await getMedication(medicationId, 'ADMIN');
            expect(hidden.status).toBe(404);
            expect(hidden.body.code).toBe('NOTIFMED_003_NOT_FOUND');
            expect(( await getMedication(medicationId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 400 of UUID and not 404 for a literal path captured as an id', async () => {
            const response = await getMedication('algo');

            expect(response.status).toBe(400);
        });

        // /activate/:id is two segments, so a GET matches no route of this router at all: the
        // 404 comes from the application and never from the medication service, which is what
        // the ordering of the literal paths before /:id is there to guarantee
        it('never reaches the service through the literal activate path', async () => {
            const response = await request(app)
                .get('/api/notification-medications/activate/algo')
                .set(authHeader('USER'));

            expect(response.status).toBe(404);
            expect(response.body.code).not.toBe('NOTIFMED_003_NOT_FOUND');
        });

        // The item is retired after the record was written: the row is historical and keeps
        // saying in which form the medication was given
        it('keeps resolving a catalog item deactivated after the record', async () => {
            const temporaryFormId = await itemOfCatalog('pharmaceuticalForm', `TEMP_${ suffix }`);
            const { medicationId } = await newMedication({ pharmaceuticalFormItemId: temporaryFormId });
            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: temporaryFormId } });

            const response = await getMedication(medicationId);
            expect(response.status).toBe(200);
            expect(response.body.data.pharmaceuticalForm.catalogItemId).toBe(temporaryFormId);
        });

    });

    describe('ESAVI-NOTIFMED-006 — the medications of a case', () => {

        it('returns every medication of the case ordered by sortOrder', async () => {
            const { notificationId, caseId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                await createMedication({ notificationId, medicationName: name });
            }

            const response = await listByCase(caseId);
            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows.map(( row: { sortOrder: number } ) => row.sortOrder)).toEqual([ 1, 2, 3 ]);
        });

        // The two 404 are deliberately distinct: the client enters through a caseId and needs
        // to know which link of the chain broke
        it('tells an unknown case from a case with no notification', async () => {
            const unknown = await listByCase(unknownUuid);
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('NOTIFMED_006_CASE_NOT_FOUND');

            const caseId = await createCaseFixture();
            const orphan = await listByCase(caseId);
            expect(orphan.status).toBe(404);
            expect(orphan.body.code).toBe('NOTIFMED_006_NOTIFICATION_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFMED-004 — the differential update', () => {

        it('writes nothing when the GET response is resent whole', async () => {
            const { medicationId } = await newMedication({
                medicationCode: 'ABC-123',
                dose: '400 mg',
                pharmaceuticalFormItemId: formItemId,
                administrationRouteItemId: routeItemId,
                startDate: '2024-05-01'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notification-medications',
                id: medicationId,
                model: NotificationMedication
            });
        });

        it('writes nothing for an empty body', async () => {
            const { medicationId } = await newMedication();
            const before = await NotificationMedication.findByPk(medicationId);

            const response = await updateMedication(medicationId, {});

            expect(response.status).toBe(200);
            expect(await auditMethods(medicationId)).toEqual([ 'ESAVI-NOTIFMED-001' ]);
            expect(( await NotificationMedication.findByPk(medicationId) )!.getDataValue('updatedAt'))
                .toEqual(before!.getDataValue('updatedAt'));
        });

        it('adds one audit entry and bumps the version by one for a single changed field', async () => {
            const { medicationId } = await newMedication();
            const before = await NotificationMedication.findByPk(medicationId);
            const versionBefore = ( before!.getDataValue('sysDetails') as { version?: number } ).version as number;

            const response = await updateMedication(medicationId, { dose: '400 mg' });

            expect(response.status).toBe(200);
            expect(await auditMethods(medicationId)).toEqual([ 'ESAVI-NOTIFMED-001', 'ESAVI-NOTIFMED-004' ]);
            const after = await NotificationMedication.findByPk(medicationId);
            expect(( after!.getDataValue('sysDetails') as { version?: number } ).version).toBe(versionBefore + 1);
        });

        // The normalization runs before comparing, or a PUT resending the GET in upper case
        // would leave audit for a value the database would store identical
        it('writes nothing for a name that only differs in case', async () => {
            const { medicationId } = await newMedication({ medicationName: 'Ibuprofeno' });

            const response = await updateMedication(medicationId, { medicationName: 'IBUPROFENO' });

            expect(response.status).toBe(200);
            expect(response.body.data.medicationName).toBe('Ibuprofeno');
            expect(await auditMethods(medicationId)).toEqual([ 'ESAVI-NOTIFMED-001' ]);
        });

        it('writes nothing for a code that only differs in surrounding blanks, hyphen included', async () => {
            const { medicationId } = await newMedication({ medicationCode: 'ABC-123' });

            const response = await updateMedication(medicationId, { medicationCode: '  ABC-123  ' });

            expect(response.status).toBe(200);
            expect(response.body.data.medicationCode).toBe('ABC-123');
            expect(await auditMethods(medicationId)).toEqual([ 'ESAVI-NOTIFMED-001' ]);
        });

        it('leaves every untouched field alone when only the dose changes', async () => {
            const { medicationId } = await newMedication({
                medicationName: 'Ibuprofeno',
                pharmaceuticalFormItemId: formItemId,
                administrationRouteItemId: routeItemId,
                startDate: '2024-05-01'
            });

            const response = await updateMedication(medicationId, { dose: '600 mg' });

            expect(response.status).toBe(200);
            const data = response.body.data;
            expect(data.medicationName).toBe('Ibuprofeno');
            expect(data.pharmaceuticalFormItemId).toBe(formItemId);
            expect(data.administrationRouteItemId).toBe(routeItemId);
            expect(data.startDate).toBe('2024-05-01');
        });

        it('clears a catalog key sent as an explicit null', async () => {
            const { medicationId } = await newMedication({ pharmaceuticalFormItemId: formItemId });

            const response = await updateMedication(medicationId, { pharmaceuticalFormItemId: null });

            expect(response.status).toBe(200);
            expect(response.body.data.pharmaceuticalFormItemId).toBeNull();
            expect(response.body.data.pharmaceuticalForm).toBeNull();
        });

        // The catalog guard runs before the diff and independently of it
        it('answers 404 for an inactive catalog key even when nothing else changes', async () => {
            const { medicationId } = await newMedication({ medicationName: 'Ibuprofeno' });

            const response = await updateMedication(medicationId, {
                medicationName: 'Ibuprofeno',
                administrationRouteItemId: inactiveRouteItemId
            });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFMED_004_ADMINISTRATION_ROUTE_NOT_FOUND');
            expect(await auditMethods(medicationId)).toEqual([ 'ESAVI-NOTIFMED-001' ]);
        });

        it('ignores notificationId and sortOrder without answering 400', async () => {
            const { medicationId, notificationId } = await newMedication();
            const { notificationId: otherNotificationId } = await notifyNewCase();

            const response = await updateMedication(medicationId, {
                notificationId: otherNotificationId,
                sortOrder: 99
            });

            expect(response.status).toBe(200);
            expect(response.body.data.notificationId).toBe(notificationId);
            expect(response.body.data.sortOrder).toBe(1);
        });

        it('answers 404 over an unknown id', async () => {
            const response = await updateMedication(unknownUuid, { dose: '400 mg' });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFMED_004_NOT_FOUND');
        });

    });

    describe('ESAVI-NOTIFMED-005A / 005B — state and the sortOrder collision', () => {

        it('seals deletedAt on the way out and answers 409 the second time', async () => {
            const { medicationId } = await newMedication();

            expect(( await deleteMedication(medicationId) ).status).toBe(200);
            const row = await NotificationMedication.findByPk(medicationId);
            expect(row!.getDataValue('isActive')).toBe(false);
            expect(row!.getDataValue('deletedAt')).not.toBeNull();

            const repeated = await deleteMedication(medicationId);
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('NOTIFMED_005A_ALREADY_INACTIVE');
        });

        // The four movements of the finding: the partial unique index is conditioned by
        // deletedAt, so the number freed by the 005A is legitimately reused by a later create
        it('moves the reactivated medication to the end when its number was taken', async () => {
            const { notificationId } = await notifyNewCase();
            const ids: string[] = [];
            for( const name of [ 'Uno', 'Dos', 'Tres' ] ) {
                const created = await createMedication({ notificationId, medicationName: name });
                ids.push(created.body.data.medicationId);
            }

            await deleteMedication(ids[2]);
            const fourth = await createMedication({ notificationId, medicationName: 'Cuatro' });
            expect(fourth.body.data.sortOrder).toBe(3);

            const reactivated = await activateMedication(ids[2]);

            expect(reactivated.status).toBe(200);
            expect(await storedSortOrder(ids[2])).toBe(4);
            expect(await sortOrders(notificationId)).toEqual([ 1, 2, 3, 4 ]);
        });

        it('leaves the sortOrder alone when the number is still free', async () => {
            const { notificationId } = await notifyNewCase();
            const ids: string[] = [];
            for( const name of [ 'Uno', 'Dos' ] ) {
                const created = await createMedication({ notificationId, medicationName: name });
                ids.push(created.body.data.medicationId);
            }
            await deleteMedication(ids[1]);

            expect(( await activateMedication(ids[1]) ).status).toBe(200);
            expect(await storedSortOrder(ids[1])).toBe(2);
        });

        // Reactivating is undoing a deactivation, not rewriting the row
        it('does not revalidate the catalogs on the way back', async () => {
            const temporaryRouteId = await itemOfCatalog('administrationRoute', `GONE_${ suffix }`);
            const { medicationId } = await newMedication({ administrationRouteItemId: temporaryRouteId });
            await deleteMedication(medicationId);
            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: temporaryRouteId } });

            expect(( await activateMedication(medicationId) ).status).toBe(200);
        });

        it('answers 409 for a medication that is already active and 404 for an unknown id', async () => {
            const { medicationId } = await newMedication();

            const repeated = await activateMedication(medicationId);
            expect(repeated.status).toBe(409);
            expect(repeated.body.code).toBe('NOTIFMED_005B_ALREADY_ACTIVE');

            const unknown = await activateMedication(unknownUuid);
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('NOTIFMED_005B_NOT_FOUND');
        });

        it('refuses the reactivation to an ADMIN', async () => {
            const { medicationId } = await newMedication();
            await deleteMedication(medicationId);

            expect(( await activateMedication(medicationId, 'ADMIN') ).status).toBe(403);
        });

    });

    describe('ESAVI-NOTIFMED-005C — physical delete', () => {

        it('refuses to purge a medication that was never retired', async () => {
            const { medicationId } = await newMedication();

            const response = await purgeMedication(medicationId);
            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFMED_005C_STILL_ACTIVE');
            expect(await NotificationMedication.findByPk(medicationId)).not.toBeNull();
        });

        // The state of the notification is deliberately not checked: a mistyped medication is
        // purged with its header active, which is the use case that motivates the operation
        it('purges a retired medication whose notification is still active', async () => {
            const { medicationId, notificationId } = await newMedication();
            await deleteMedication(medicationId);

            const response = await purgeMedication(medicationId);

            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(await NotificationMedication.findByPk(medicationId)).toBeNull();
            expect(( await Notification.findByPk(notificationId) )!.getDataValue('isActive')).toBe(true);
        });

        it('answers 404 the second time and 403 for an ADMIN', async () => {
            const { medicationId } = await newMedication();
            await deleteMedication(medicationId);

            expect(( await purgeMedication(medicationId, 'ADMIN') ).status).toBe(403);
            expect(( await purgeMedication(medicationId) ).status).toBe(200);

            const repeated = await purgeMedication(medicationId);
            expect(repeated.status).toBe(404);
            expect(repeated.body.code).toBe('NOTIFMED_005C_NOT_FOUND');
        });

        // ON DELETE RESTRICT protects the catalog from the other side, and the purge of the
        // medication never touches it
        it('leaves the referenced catalog items intact', async () => {
            const { medicationId } = await newMedication({
                pharmaceuticalFormItemId: formItemId,
                administrationRouteItemId: routeItemId
            });
            await deleteMedication(medicationId);

            expect(( await purgeMedication(medicationId) ).status).toBe(200);
            expect(await CatalogItem.findByPk(formItemId)).not.toBeNull();
            expect(await CatalogItem.findByPk(routeItemId)).not.toBeNull();
        });

    });

    describe('the cascade of ESAVI-NOTIFCN-005C', () => {

        it('drags every medication of the purged notification', async () => {
            const { notificationId } = await notifyNewCase();
            for( const name of [ 'Uno', 'Dos', 'Tres', 'Cuatro' ] ) {
                await createMedication({ notificationId, medicationName: name });
            }
            await deactivateNotification(notificationId);

            const purged = await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await NotificationMedication.count({ where: { notificationId } })).toBe(0);
        });

    });

});
