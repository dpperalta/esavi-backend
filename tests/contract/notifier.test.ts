import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType, EsaviCase, GeoLevelType, GeoLocation, HealthFacility, Notifier, Patient } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the eight notifier operations of SPEC F07. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the four
 * PII columns normalized before being encrypted and decrypted again on the way
 * out, the three foreign keys that no database trigger validates, the caseId
 * that is required on create and silently ignored on update, and the deliberate
 * absence of any uniqueness rule.
 */
describe('notifier contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // Fixtures shared by the whole file. Notifiers need a case, and the optional
    // profession has to belong to the catalogType coded 'profession'
    let caseId: string;
    let otherCaseId: string;
    let inactiveCaseId: string;
    let professionItemId: string;
    let otherProfessionItemId: string;
    let inactiveProfessionItemId: string;
    let wrongCatalogItemId: string;
    let geoLocationId: string;
    let inactiveGeoLocationId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    const createNotifier = ( payload: Record<string, unknown> = {}, role: TestRole = 'USER' ) =>
        request(app)
            .post('/api/notifiers')
            .set(authHeader(role))
            .send({ caseId, firstName: 'Ana', lastName: 'Perez', ...payload });

    const getNotifier = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notifiers/${ id }`).set(authHeader(role));

    const listNotifiers = ( query: string = '', role: TestRole = 'USER' ) =>
        request(app).get(`/api/notifiers${ query }`).set(authHeader(role));

    const listAdminNotifiers = ( query: string = '', role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/notifiers/admin${ query }`).set(authHeader(role));

    const updateNotifier = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/notifiers/${ id }`).set(authHeader(role)).send(payload);

    const deleteNotifier = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notifiers/${ id }`).set(authHeader(role));

    const activateNotifier = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notifiers/activate/${ id }`).set(authHeader(role));

    const purgeNotifier = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notifiers/purge/${ id }`).set(authHeader(role));

    const createCaseFixture = async ( label: string, isActive: boolean = true ): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Notifier ${ label }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`NT${ label }${ suffix }`),
            healthSystemCode: `NT${ label }${ suffix }`
        });
        const facility = await HealthFacility.create({
            localCode: `NT${ label }${ suffix }`,
            name: `Notifier ${ label } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `NT-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            isActive
        });
        return esaviCase.getDataValue('caseId');
    };

    const createProfessionFixture = async ( label: string, isActive: boolean = true ): Promise<string> => {
        // The catalogType coded 'profession' is a precondition of SPEC F07 and is not seeded
        // by esaviapp.sql, so the suite creates it once and hangs its items off it
        const professionType = await CatalogType.findOne({ where: { code: 'profession' } })
            ?? await CatalogType.create({ code: 'profession', name: 'Profession' });
        const item = await CatalogItem.create({
            catalogTypeId: professionType.getDataValue('catalogTypeId'),
            code: `NTP${ label }${ suffix }`,
            name: `Profession ${ label }`,
            value: `Profession ${ label }`,
            isActive
        });
        return item.getDataValue('catalogItemId');
    };

    const createGeoLocationFixture = async ( label: string, isActive: boolean = true ): Promise<string> => {
        const geoLevelType = await GeoLevelType.create({
            code: `NT${ label }${ suffix }`,
            name: `Notifier ${ label } ${ suffix }`,
            sortOrder: 1
        });
        const geoLocation = await GeoLocation.create({
            geoLevelTypeId: geoLevelType.getDataValue('geoLevelTypeId'),
            name: `Notifier ${ label } ${ suffix }`,
            level: 1,
            isActive
        });
        return geoLocation.getDataValue('geoLocationId');
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        caseId = await createCaseFixture('A');
        otherCaseId = await createCaseFixture('B');
        inactiveCaseId = await createCaseFixture('I', false);

        professionItemId = await createProfessionFixture('A');
        otherProfessionItemId = await createProfessionFixture('B');
        inactiveProfessionItemId = await createProfessionFixture('I', false);

        // An item of a different catalogType, to prove the profession check looks at the type
        const sexType = await CatalogType.findOne({ where: { code: 'sex' } });
        const sexItem = await CatalogItem.findOne({
            where: { catalogTypeId: sexType!.getDataValue('catalogTypeId') }
        });
        wrongCatalogItemId = sexItem!.getDataValue('catalogItemId');

        geoLocationId = await createGeoLocationFixture('A');
        inactiveGeoLocationId = await createGeoLocationFixture('I', false);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('ESAVI-NOTIFIER-001 — create', () => {

        it('creates a notifier and answers 201 with the full shape', async () => {
            const response = await createNotifier({
                professionItemId, geoLocationId,
                phoneNumber: '0999999999', room: '12B', details: 'free text'
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);
            expect(response.body.data.notifierId).toEqual(expect.any(String));
            expect(response.body.data.case).toMatchObject({ caseId });
            expect(response.body.data.profession).toMatchObject({ catalogItemId: professionItemId });
            expect(response.body.data.geoLocation).toMatchObject({ geoLocationId });
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-NOTIFIER-001');
        });

        it('normalizes before encrypting and answers with the plain text', async () => {
            const response = await createNotifier({
                firstName: 'maría josé',
                lastName: 'del valle',
                email: '  ANA@Correo.EC  ',
                address: 'av. amazonas 123',
                room: '  12B  '
            });

            expect(response.body.data.firstName).toBe('María José');
            expect(response.body.data.lastName).toBe('Del Valle');
            expect(response.body.data.email).toBe('ana@correo.ec');
            expect(response.body.data.address).toBe('Av. Amazonas 123');
            expect(response.body.data.room).toBe('12B');
        });

        it('stores the four PII columns encrypted and the other three in clear text', async () => {
            const created = await createNotifier({
                firstName: 'maría josé', email: 'ana@correo.ec', address: 'av. amazonas 123',
                phoneNumber: '0999999999', room: '12B', details: 'free text'
            });

            const row = await Notifier.findByPk(created.body.data.notifierId);

            expect(row!.getDataValue('firstName')).toBe(esaviCrypt('María José'));
            expect(row!.getDataValue('firstName')).not.toBe('María José');
            expect(row!.getDataValue('email')).toBe(esaviCrypt('ana@correo.ec'));
            expect(row!.getDataValue('address')).toBe(esaviCrypt('Av. Amazonas 123'));
            expect(row!.getDataValue('phoneNumber')).toBe('0999999999');
            expect(row!.getDataValue('room')).toBe('12B');
            expect(row!.getDataValue('details')).toBe('free text');
        });

        it('creates a notifier with no profession and no geoLocation, answering null on both', async () => {
            const response = await createNotifier();

            expect(response.status).toBe(201);
            expect(response.body.data.profession).toBeNull();
            expect(response.body.data.geoLocation).toBeNull();
        });

        it('creates two identical notifiers on the same case: there is no uniqueness', async () => {
            const payload = { firstName: 'Gemelo', lastName: 'Notificador', email: 'gemelo@correo.ec' };
            const first = await createNotifier(payload);
            const second = await createNotifier(payload);

            expect(first.status).toBe(201);
            expect(second.status).toBe(201);
            expect(first.body.data.notifierId).not.toBe(second.body.data.notifierId);
        });

        it('accepts the maximum lengths the validator allows on the encrypted columns', async () => {
            const response = await createNotifier({
                firstName: 'á'.repeat(150),
                lastName: 'é'.repeat(150),
                address: 'ü'.repeat(250)
            });

            expect(response.status).toBe(201);
            expect(response.body.data.firstName).toHaveLength(150);
            expect(response.body.data.address).toHaveLength(250);
        });

        it('answers 404 for a caseId that does not exist', async () => {
            const response = await createNotifier({ caseId: unknownUuid });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_001_CASE_NOT_FOUND');
        });

        it('answers 404 for an inactive caseId', async () => {
            const response = await createNotifier({ caseId: inactiveCaseId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_001_CASE_NOT_FOUND');
        });

        it('answers 404 for a professionItemId of another catalogType', async () => {
            const response = await createNotifier({ professionItemId: wrongCatalogItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_001_PROFESSION_NOT_FOUND');
        });

        it('answers 404 for an inactive professionItemId', async () => {
            const response = await createNotifier({ professionItemId: inactiveProfessionItemId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_001_PROFESSION_NOT_FOUND');
        });

        it('answers 404 for an inactive geoLocationId', async () => {
            const response = await createNotifier({ geoLocationId: inactiveGeoLocationId });

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_001_GEOLOCATION_NOT_FOUND');
        });

        it('answers 400 without caseId, without firstName or without lastName', async () => {
            const noCase = await request(app).post('/api/notifiers').set(authHeader('USER'))
                .send({ firstName: 'Ana', lastName: 'Perez' });
            const noFirstName = await request(app).post('/api/notifiers').set(authHeader('USER'))
                .send({ caseId, lastName: 'Perez' });
            const noLastName = await request(app).post('/api/notifiers').set(authHeader('USER'))
                .send({ caseId, firstName: 'Ana' });

            expect(noCase.status).toBe(400);
            expect(noFirstName.status).toBe(400);
            expect(noLastName.status).toBe(400);
        });

        it('answers 400 for a malformed email and for an over-long firstName', async () => {
            const badEmail = await createNotifier({ email: 'not-an-email' });
            const longName = await createNotifier({ firstName: 'a'.repeat(151) });

            expect(badEmail.status).toBe(400);
            expect(longName.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFIER-003 — get by id', () => {

        it('answers the full shape with the four PII fields decrypted and no sysDetails', async () => {
            const created = await createNotifier({
                firstName: 'maría josé', email: 'ana@correo.ec', address: 'av. amazonas 123',
                professionItemId, geoLocationId, details: 'free text'
            });

            const response = await getNotifier(created.body.data.notifierId);

            expect(response.status).toBe(200);
            expect(response.body.data.firstName).toBe('María José');
            expect(response.body.data.email).toBe('ana@correo.ec');
            expect(response.body.data.address).toBe('Av. Amazonas 123');
            expect(response.body.data.details).toBe('free text');
            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data).not.toHaveProperty('caseId');
            expect(response.body.data).not.toHaveProperty('professionItemId');
            expect(response.body.data).not.toHaveProperty('geoLocationId');
        });

        it('answers 404 for an id that does not exist', async () => {
            const response = await getNotifier(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFIER_003_NOT_FOUND');
        });

        it('answers 400 for an id that is not a UUID', async () => {
            const response = await getNotifier('not-a-uuid');

            expect(response.status).toBe(400);
        });

        it('hides an inactive notifier from USER and ADMIN, and shows it to SUPERADMIN', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;
            await deleteNotifier(id);

            const asUser = await getNotifier(id, 'USER');
            const asAdmin = await getNotifier(id, 'ADMIN');
            const asSuperAdmin = await getNotifier(id, 'SUPERADMIN');

            expect(asUser.status).toBe(404);
            expect(asAdmin.status).toBe(404);
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.isActive).toBe(false);
        });

    });

    describe('ESAVI-NOTIFIER-002A / 002B — lists', () => {

        // A case of its own so the counts do not depend on what the other blocks created
        let listCaseId: string;
        let listInactiveNotifierId: string;

        beforeAll(async () => {
            listCaseId = await createCaseFixture('L');
            await createNotifier({ caseId: listCaseId, firstName: 'Uno', details: 'must not travel' });
            await createNotifier({ caseId: listCaseId, firstName: 'Dos', professionItemId, geoLocationId, email: 'dos@correo.ec', address: 'av. loja 45', room: '3A', phoneNumber: '0991111111' });
            await createNotifier({ caseId: listCaseId, firstName: 'Tres', professionItemId: otherProfessionItemId });

            const stray = await createNotifier({ caseId: listCaseId, firstName: 'Retirado' });
            listInactiveNotifierId = stray.body.data.notifierId;
            await deleteNotifier(listInactiveNotifierId);
        });

        it('hides inactive notifiers on the public list and shows them on the admin one', async () => {
            const publicList = await listNotifiers(`?caseId=${ listCaseId }&limit=100`);
            const adminList = await listAdminNotifiers(`?caseId=${ listCaseId }&limit=100`);

            expect(publicList.body.data.count).toBe(3);
            expect(adminList.body.data.count).toBe(4);
            expect(publicList.body.data.rows.map(( row: { notifierId: string } ) => row.notifierId))
                .not.toContain(listInactiveNotifierId);
        });

        it('answers 403 to a USER on the admin list', async () => {
            const response = await listAdminNotifiers('', 'USER');

            expect(response.status).toBe(403);
        });

        it('answers 200 with count 0 for a caseId that does not exist, never 404', async () => {
            const response = await listNotifiers(`?caseId=${ unknownUuid }`);

            expect(response.status).toBe(200);
            expect(response.body.data).toEqual({ count: 0, rows: [] });
        });

        it('accumulates the three filters with AND', async () => {
            const matching = await listNotifiers(`?caseId=${ listCaseId }&professionItemId=${ professionItemId }&geoLocationId=${ geoLocationId }`);
            const contradictory = await listNotifiers(`?caseId=${ otherCaseId }&professionItemId=${ professionItemId }`);

            expect(matching.body.data.count).toBe(1);
            expect(matching.body.data.rows[0].firstName).toBe('Dos');
            expect(contradictory.body.data.count).toBe(0);
        });

        it('returns the reduced shape, decrypted, without details, appDetails or sysDetails', async () => {
            const response = await listNotifiers(`?caseId=${ listCaseId }&professionItemId=${ professionItemId }`);
            const row = response.body.data.rows[0];

            expect(row.email).toBe('dos@correo.ec');
            expect(row.address).toBe('Av. Loja 45');
            expect(row.room).toBe('3A');
            expect(row.phoneNumber).toBe('0991111111');
            expect(row).not.toHaveProperty('details');
            expect(row).not.toHaveProperty('appDetails');
            expect(row).not.toHaveProperty('sysDetails');
            expect(row.case).toMatchObject({ caseId: listCaseId });
        });

        it('paginates keeping the total count and orders by createdAt DESC', async () => {
            const response = await listNotifiers(`?caseId=${ listCaseId }&limit=2`);

            expect(response.body.data.count).toBe(3);
            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.rows[0].firstName).toBe('Tres');
            expect(response.body.data.rows[1].firstName).toBe('Dos');
        });

        it('answers 400 for a filter that is not a UUID and for an out-of-range limit', async () => {
            const badFilter = await listNotifiers('?caseId=not-a-uuid');
            const badLimit = await listNotifiers('?limit=999');

            expect(badFilter.status).toBe(400);
            expect(badLimit.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFIER-004 — update', () => {

        it('ignores caseId in the body and keeps the original case', async () => {
            const created = await createNotifier();

            const response = await updateNotifier(created.body.data.notifierId, { caseId: otherCaseId, room: '9C' });

            expect(response.status).toBe(200);
            expect(response.body.data.case.caseId).toBe(caseId);
            expect(response.body.data.room).toBe('9C');
        });

        it('leaves firstName untouched and not doubly encrypted when only lastName changes', async () => {
            const created = await createNotifier({ firstName: 'maría josé' });

            const response = await updateNotifier(created.body.data.notifierId, { lastName: 'nuevo apellido' });

            expect(response.body.data.firstName).toBe('María José');
            expect(response.body.data.lastName).toBe('Nuevo Apellido');
            const row = await Notifier.findByPk(created.body.data.notifierId);
            expect(row!.getDataValue('firstName')).toBe(esaviCrypt('María José'));
        });

        it('normalizes and encrypts what arrives, and clears the nullable fields', async () => {
            const created = await createNotifier({ email: 'viejo@correo.ec', address: 'calle vieja 1', room: '1A' });

            const response = await updateNotifier(created.body.data.notifierId, {
                email: '  NUEVO@Correo.EC  ', address: 'av. nueva 99', room: null
            });

            expect(response.body.data.email).toBe('nuevo@correo.ec');
            expect(response.body.data.address).toBe('Av. Nueva 99');
            expect(response.body.data.room).toBeNull();
        });

        it('preserves the previous appDetails entries and adds none when there are no changes', async () => {
            const created = await createNotifier();

            const response = await updateNotifier(created.body.data.notifierId, {});

            expect(response.status).toBe(200);
            // An update that touched nothing is not a change: appDetails counts changes, not
            // the times a form was opened and closed, so only the create entry is there
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(response.body.data.appDetails[0].method).toBe('ESAVI-NOTIFIER-001');

            // And a real change does append, without dropping what came before
            const changed = await updateNotifier(created.body.data.notifierId, { room: '3C' });
            expect(changed.body.data.appDetails).toHaveLength(2);
            expect(changed.body.data.appDetails[1].method).toBe('ESAVI-NOTIFIER-004');
        });

        it('leaves the encrypted column byte for byte identical when the value is resent', async () => {
            const created = await createNotifier({ email: 'mismo@correo.ec' });
            const id = created.body.data.notifierId;
            const before = await Notifier.findByPk(id);

            const response = await updateNotifier(id, { email: 'mismo@correo.ec' });

            expect(response.status).toBe(200);
            const after = await Notifier.findByPk(id);
            expect(after!.getDataValue('email')).toBe(before!.getDataValue('email'));
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

        it('answers 404 for a notifier, a profession or a geoLocation that is not valid', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;

            const missing = await updateNotifier(unknownUuid, { room: '1A' });
            const badProfession = await updateNotifier(id, { professionItemId: wrongCatalogItemId });
            const badGeoLocation = await updateNotifier(id, { geoLocationId: inactiveGeoLocationId });

            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('NOTIFIER_004_NOT_FOUND');
            expect(badProfession.status).toBe(404);
            expect(badProfession.body.code).toBe('NOTIFIER_004_PROFESSION_NOT_FOUND');
            expect(badGeoLocation.status).toBe(404);
            expect(badGeoLocation.body.code).toBe('NOTIFIER_004_GEOLOCATION_NOT_FOUND');
        });

        it('answers 400 for a malformed email', async () => {
            const created = await createNotifier();

            const response = await updateNotifier(created.body.data.notifierId, { email: 'not-an-email' });

            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-NOTIFIER-005A / 005B — deactivate and reactivate', () => {

        it('deactivates and reactivates, answering without data both times', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;

            const deleted = await deleteNotifier(id);
            expect(deleted.status).toBe(200);
            expect(deleted.body).not.toHaveProperty('data');
            const afterDelete = await Notifier.findByPk(id);
            expect(afterDelete!.getDataValue('isActive')).toBe(false);
            expect(afterDelete!.getDataValue('deletedAt')).not.toBeNull();

            const activated = await activateNotifier(id);
            expect(activated.status).toBe(200);
            expect(activated.body).not.toHaveProperty('data');
            const afterActivate = await Notifier.findByPk(id);
            expect(afterActivate!.getDataValue('isActive')).toBe(true);
            expect(afterActivate!.getDataValue('deletedAt')).toBeNull();
        });

        it('answers 409 when repeating the state', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;

            const alreadyActive = await activateNotifier(id);
            await deleteNotifier(id);
            const alreadyInactive = await deleteNotifier(id);

            expect(alreadyActive.status).toBe(409);
            expect(alreadyActive.body.code).toBe('NOTIFIER_005B_ALREADY_ACTIVE');
            expect(alreadyInactive.status).toBe(409);
            expect(alreadyInactive.body.code).toBe('NOTIFIER_005A_ALREADY_INACTIVE');
        });

        it('answers 403 to an ADMIN on the activate route', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;
            await deleteNotifier(id);

            const response = await activateNotifier(id, 'ADMIN');

            expect(response.status).toBe(403);
        });

        it('records only the operation code in appDetails.method, with no suffix', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;
            await deleteNotifier(id);
            await activateNotifier(id);

            const row = await Notifier.findByPk(id);
            const methods = ( row!.getDataValue('appDetails') as { method: string }[] ).map(( entry ) => entry.method);

            expect(methods).toEqual(['ESAVI-NOTIFIER-001', 'ESAVI-NOTIFIER-005A', 'ESAVI-NOTIFIER-005B']);
        });

        it('reactivates a notifier whose case is inactive, answering 200', async () => {
            const orphanCaseId = await createCaseFixture('O');
            const created = await createNotifier({ caseId: orphanCaseId });
            const id = created.body.data.notifierId;
            await deleteNotifier(id);
            await EsaviCase.update({ isActive: false, deletedAt: new Date() }, { where: { caseId: orphanCaseId } });

            const response = await activateNotifier(id);

            expect(response.status).toBe(200);
        });

    });

    describe('ESAVI-NOTIFIER-005C — purge', () => {

        it('answers 409 for an active notifier and leaves the row in place', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;

            const response = await purgeNotifier(id);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFIER_005C_STILL_ACTIVE');
            expect(await Notifier.findByPk(id)).not.toBeNull();
        });

        it('destroys a deactivated notifier and answers 404 when repeated', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;
            await deleteNotifier(id);

            const response = await purgeNotifier(id);

            expect(response.status).toBe(200);
            expect(response.body).not.toHaveProperty('data');
            expect(await Notifier.findByPk(id, { paranoid: false })).toBeNull();

            const again = await purgeNotifier(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('NOTIFIER_005C_NOT_FOUND');
        });

        it('answers 403 to an ADMIN', async () => {
            const created = await createNotifier();
            const id = created.body.data.notifierId;
            await deleteNotifier(id);

            const response = await purgeNotifier(id, 'ADMIN');

            expect(response.status).toBe(403);
            expect(await Notifier.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('does not alter the case the notifier belonged to', async () => {
            const purgeCaseId = await createCaseFixture('P');
            const created = await createNotifier({ caseId: purgeCaseId });
            const id = created.body.data.notifierId;
            await deleteNotifier(id);

            await purgeNotifier(id);

            const esaviCase = await EsaviCase.findByPk(purgeCaseId);
            expect(esaviCase).not.toBeNull();
            expect(esaviCase!.getDataValue('isActive')).toBe(true);
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await createNotifier({
                firstName: 'diferencial',
                lastName: 'notificador',
                email: 'diferencial@correo.ec',
                address: 'av. diferencial 12',
                room: '4B',
                phoneNumber: '0991234567',
                professionItemId,
                geoLocationId,
                details: 'Sin novedad'
            });
            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notifiers',
                id: created.body.data.notifierId,
                model: Notifier
            });
        });

    });

});
