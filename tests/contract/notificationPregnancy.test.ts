import fs from 'fs';
import path from 'path';
import request from 'supertest';
import {
    CatalogItem,
    CatalogType,
    EsaviCase,
    HealthFacility,
    NotificationPregnancy,
    Patient,
    SystemConfig,
    sequelize
} from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import es from '../../src/data/i18n/es.json';
import en from '../../src/data/i18n/en.json';
import nl from '../../src/data/i18n/nl.json';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven notificationPregnancy operations of SPEC F25. It walks the
 * entity end to end — create, read by id, read by notification, update, deactivate,
 * reactivate, purge — and covers what cannot be checked by hand reliably.
 *
 * This is the seventh satellite of notification and a shape none of the six before it had:
 * one to one *and* with its own state. Three axes are proper to it.
 *
 * The plain UNIQUE. UQ_notificationPregnancy_notification is a column constraint and not a
 * partial index conditioned by deletedAt, so a withdrawn row keeps occupying the slot and a
 * second create answers 409 even over an INACTIVE row. That contradicts the intuition the
 * four one to many sisters built, so the two 409 — over an active row and over a withdrawn
 * one — are mounted as separate scenarios on purpose.
 *
 * The female sex rule, which makes this the first consumer of systemConfig in the repository.
 * Five deviations from the declared contract of the PREGNANCY_FEMALE_SEX_ITEM row answer 500
 * and never 400, and the isEncrypted one is the scenario that matters most: without its guard
 * it would produce a plausible but false 400 over patients who ARE female.
 *
 * The gestational range, Naegele with a +/- 14 day tolerance, with both bounds inclusive and
 * evaluated over the RESULTING state on update — never over the body.
 */
describe('notificationPregnancy contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';
    const logFile = path.join(__dirname, '..', '..', 'src', 'logs', 'esaviLog.log');
    const configCode = 'PREGNANCY_FEMALE_SEX_ITEM';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let counter = 0;
    let retired = 0;

    // The data precondition the spec declares: the sex catalog is populated by hand, so the suite
    // seeds the two items it needs and points the configuration at the female one
    let femaleItemId: string;
    let maleItemId: string;

    beforeAll(async () => {
        await seedTestUsers();
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

        const catalogType = await CatalogType.create({ code: `sex${ suffix }`, name: `Sex ${ suffix }` });
        const catalogTypeId = catalogType.getDataValue('catalogTypeId');
        femaleItemId = ( await CatalogItem.create({
            catalogTypeId, code: `F${ suffix }`, name: 'Femenino', value: '2'
        }) ).getDataValue('catalogItemId');
        maleItemId = ( await CatalogItem.create({
            catalogTypeId, code: `M${ suffix }`, name: 'Masculino', value: '1'
        }) ).getDataValue('catalogItemId');
    });

    // Every test starts from a healthy configuration row, so the five failure scenarios can break
    // it freely without leaking into the next one
    beforeEach(async () => {
        await seedConfig();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // systemConfigHistory hangs from the row with ON DELETE RESTRICT, so the previous rows are
    // retired by renaming their code instead of being destroyed: the service reads by (code, scope),
    // so a renamed row is an absent one as far as the rule is concerned
    const retireConfig = async (): Promise<void> => {
        retired += 1;
        await SystemConfig.update({ code: `RETIRED_${ suffix }_${ retired }` }, { where: { code: configCode } });
    };

    // The row is created through ESAVI-SYSCONF-001, never from src/data/systemConfig.defaults.ts:
    // its value is a UUID that changes per installation and the 008 is create-only
    const seedConfig = async ( overrides: Record<string, unknown> = {} ): Promise<string> => {
        await retireConfig();
        const created = await request(app).post('/api/system-configs').set(authHeader('SUPERADMIN')).send({
            code: configCode,
            name: 'Pregnancy female sex item',
            value: femaleItemId,
            valueType: 'string',
            scope: 'GLOBAL',
            isEncrypted: false,
            ...overrides
        });
        return created.body.data.systemConfigId;
    };

    const notifyNewCase = async (
        sexItemId: string | null = femaleItemId,
        notificationType: string = 'NON_SEVERE'
    ): Promise<{ notificationId: string, patientId: string }> => {
        counter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Pregnancy ${ counter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`PG${ counter }${ suffix }`),
            healthSystemCode: `PG${ counter }${ suffix }`,
            birthDate: '2000-05-04',
            sexItemId
        });
        const facility = await HealthFacility.create({
            localCode: `PG${ counter }${ suffix }`,
            name: `Pregnancy ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `PG-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2026-12-31'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        const created = await request(app).post('/api/notifications').set(authHeader('USER')).send({
            caseId: esaviCase.getDataValue('caseId'),
            notificationType,
            esaviDescription: 'Fever after the dose'
        });
        return { notificationId: created.body.data.notificationId, patientId: patient.getDataValue('patientId') };
    };

    const createPregnancy = ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).post('/api/notification-pregnancies').set(authHeader(role)).send(payload);

    const getPregnancy = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-pregnancies/${ id }`).set(authHeader(role));

    const getByNotification = ( notificationId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/notification-pregnancies/notification/${ notificationId }`).set(authHeader(role));

    const updatePregnancy = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/notification-pregnancies/${ id }`).set(authHeader(role)).send(payload);

    const deletePregnancy = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notification-pregnancies/${ id }`).set(authHeader(role));

    const activatePregnancy = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notification-pregnancies/activate/${ id }`).set(authHeader(role));

    const purgePregnancy = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/notification-pregnancies/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader('ADMIN'));

    // A brand new pregnancy over its own notification, ready to be read or updated
    const newPregnancy = async (
        payload: Record<string, unknown> = {}
    ): Promise<{ pregnancyId: string, notificationId: string, patientId: string }> => {
        const { notificationId, patientId } = await notifyNewCase();
        const created = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES', ...payload });
        return { pregnancyId: created.body.data.pregnancyId, notificationId, patientId };
    };

    const auditMethods = async ( id: string ): Promise<string[]> => {
        const row = await NotificationPregnancy.findByPk(id);
        return ( row?.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
    };

    const rowVersion = async ( id: string ): Promise<number | undefined> => {
        const row = await NotificationPregnancy.findByPk(id);
        return ( row?.getDataValue('sysDetails') as { version?: number } | null )?.version;
    };

    // notificationPregnancyComplication has no model until its own spec, so the child rows this
    // suite needs are written and counted with raw SQL — the same reason the 005C reads them that way
    const addComplications = async ( pregnancyId: string, names: string[] ): Promise<string[]> => {
        const ids: string[] = [];
        for( const complicationRawName of names ) {
            const [ rows ] = await sequelize.query(
                'INSERT INTO "notificationPregnancyComplication" ("pregnancyId", "complicationRawName") ' +
                'VALUES (:pregnancyId, :complicationRawName) RETURNING "complicationId"',
                { replacements: { pregnancyId, complicationRawName } }
            );
            ids.push(( rows as { complicationId: string }[] )[0].complicationId);
        }
        return ids;
    };

    const countComplications = async ( pregnancyId: string ): Promise<number> => {
        const [ rows ] = await sequelize.query(
            'SELECT count(*)::int AS total FROM "notificationPregnancyComplication" WHERE "pregnancyId" = :pregnancyId',
            { replacements: { pregnancyId } }
        );
        return ( rows as { total: number }[] )[0].total;
    };

    const logLines = ( needle: string ): string[] =>
        fs.readFileSync(logFile, 'utf8').split('\n').filter(line => line.includes(needle));

    describe('the full walkthrough', () => {

        it('creates, reads by id, reads by notification, updates, deactivates, reactivates and purges', async () => {
            const { notificationId } = await notifyNewCase();

            const created = await createPregnancy({
                notificationId,
                wasPregnantAtVaccination: 'YES',
                wasPregnantAtEsavi: 'YES',
                lastMenstruationDate: '2026-01-01',
                probableDeliveryDate: '2026-10-08',
                hasComplications: 'NO',
                notes: '  Gestante de 32 semanas  '
            });
            expect(created.status).toBe(201);
            const pregnancyId = created.body.data.pregnancyId;
            expect(created.body.data.notes).toBe('Gestante de 32 semanas');

            const byId = await getPregnancy(pregnancyId);
            expect(byId.status).toBe(200);
            expect(byId.body.data.pregnancyId).toBe(pregnancyId);

            const byNotification = await getByNotification(notificationId);
            expect(byNotification.status).toBe(200);
            expect(byNotification.body.data.pregnancyId).toBe(pregnancyId);

            const updated = await updatePregnancy(pregnancyId, { hasComplications: 'YES' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.hasComplications).toBe('YES');

            expect(( await deletePregnancy(pregnancyId) ).status).toBe(200);
            expect(( await activatePregnancy(pregnancyId) ).status).toBe(200);
            expect(( await deletePregnancy(pregnancyId) ).status).toBe(200);
            expect(( await purgePregnancy(pregnancyId) ).status).toBe(200);

            expect(await NotificationPregnancy.findByPk(pregnancyId)).toBeNull();
        });

        it('returns the bare row: no sysDetails, no nested notification, notificationId raw', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            const response = await getPregnancy(pregnancyId);

            expect(response.body.data.notificationId).toBe(notificationId);
            expect(response.body.data.sysDetails).toBeUndefined();
            expect(response.body.data.notification).toBeUndefined();
            expect(response.body.data.appDetails).toBeDefined();
        });

        it('a minimal create leaves the other five data fields null', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(201);
            expect(response.body.data.wasPregnantAtEsavi).toBeNull();
            expect(response.body.data.lastMenstruationDate).toBeNull();
            expect(response.body.data.probableDeliveryDate).toBeNull();
            expect(response.body.data.hasComplications).toBeNull();
            expect(response.body.data.notes).toBeNull();
        });

        it('writes the operation code into appDetails on create, update and both activations', async () => {
            const { pregnancyId } = await newPregnancy();
            await updatePregnancy(pregnancyId, { notes: 'Primera gestación' });
            await deletePregnancy(pregnancyId);
            await activatePregnancy(pregnancyId);

            expect(await auditMethods(pregnancyId)).toEqual([
                'ESAVI-NOTIFPRG-001',
                'ESAVI-NOTIFPRG-004',
                'ESAVI-NOTIFPRG-005A',
                'ESAVI-NOTIFPRG-005B'
            ]);
        });

    });

    describe('the one to one and its plain UNIQUE', () => {

        it('answers 409 on a second create over an ACTIVE row', async () => {
            const { notificationId } = await newPregnancy();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'NO' });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFPRG_001_ALREADY_EXISTS');
        });

        it('answers 409 on a second create over an INACTIVE row too, not 201', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            await deletePregnancy(pregnancyId);

            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'NO' });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('NOTIFPRG_001_ALREADY_EXISTS');
        });

        it('names the activation operation in the alreadyExists message of the three languages', async () => {
            for( const catalog of [es, en, nl] ) {
                expect(catalog.notificationPregnancy.alreadyExists).toContain('/activate/');
            }
        });

        it('gives back the very same row after a 005A and a 005B', async () => {
            const { pregnancyId, notificationId } = await newPregnancy({
                notes: 'Gestante de 32 semanas',
                wasPregnantAtEsavi: 'NO'
            });
            await deletePregnancy(pregnancyId);
            await activatePregnancy(pregnancyId);

            const response = await getByNotification(notificationId);
            expect(response.status).toBe(200);
            expect(response.body.data.pregnancyId).toBe(pregnancyId);
            expect(response.body.data.notes).toBe('Gestante de 32 semanas');
            expect(response.body.data.wasPregnantAtEsavi).toBe('NO');
        });

        it('frees the slot only through the 005C', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            await deletePregnancy(pregnancyId);
            await purgePregnancy(pregnancyId);

            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'NO' });
            expect(response.status).toBe(201);
        });

    });

    describe('the female sex rule', () => {

        it('answers 400 over a patient whose recorded sex is not the configured one', async () => {
            const { notificationId } = await notifyNewCase(maleItemId);
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFPRG_001_PATIENT_NOT_FEMALE');
        });

        it('answers 201 over a patient with sexItemId null: an unknown sex does not block', async () => {
            const { notificationId } = await notifyNewCase(null);
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(201);
        });

        it('answers 500 when the configuration row is ABSENT, never 400', async () => {
            await retireConfig();
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(500);
            expect(response.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');
        });

        it('answers 500 when the configuration row is INACTIVE', async () => {
            const systemConfigId = await seedConfig();
            await request(app).delete(`/api/system-configs/${ systemConfigId }`).set(authHeader('SUPERADMIN'));

            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(500);
            expect(response.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');
        });

        it('answers 500 when valueType is not string', async () => {
            await seedConfig({ value: 42, valueType: 'number' });

            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(500);
            expect(response.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');
        });

        // The scenario that matters most: without the explicit guard, the wrapped ciphertext would
        // never match any sexItemId and a female patient would get a plausible but false 400
        it('answers 500 when the row is marked isEncrypted, over a FEMALE patient, and never 400', async () => {
            await seedConfig({ isEncrypted: true });

            const { notificationId } = await notifyNewCase(femaleItemId);
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });

            expect(response.status).toBe(500);
            expect(response.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');
            expect(response.body.code).not.toBe('NOTIFPRG_001_PATIENT_NOT_FEMALE');
        });

        it('answers 500 when the value points at no catalogItem, and when it is not a UUID at all', async () => {
            await seedConfig({ value: unknownUuid });
            const first = await notifyNewCase();
            const missing = await createPregnancy({ notificationId: first.notificationId, wasPregnantAtVaccination: 'YES' });
            expect(missing.status).toBe(500);
            expect(missing.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');

            await seedConfig({ value: 'femenino' });
            const second = await notifyNewCase();
            const notUuid = await createPregnancy({ notificationId: second.notificationId, wasPregnantAtVaccination: 'YES' });
            expect(notUuid.status).toBe(500);
            expect(notUuid.body.code).toBe('NOTIFPRG_001_SEX_CONFIG_MISSING');
        });

        it('does not run on update: a PUT answers 200 with a broken configuration', async () => {
            const { pregnancyId } = await newPregnancy();
            await retireConfig();

            const response = await updatePregnancy(pregnancyId, { notes: 'Corrección posterior' });
            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('Corrección posterior');
        });

        it('does not run on reactivation: a patient who changed sex meanwhile answers 200', async () => {
            const { pregnancyId, patientId } = await newPregnancy();
            await deletePregnancy(pregnancyId);
            await Patient.update({ sexItemId: maleItemId }, { where: { patientId } });

            expect(( await activatePregnancy(pregnancyId) ).status).toBe(200);
        });

    });

    describe('the gestational range', () => {

        // 2026-01-01 plus 266 and plus 294 days: both bounds are inclusive
        it.each([
            ['2026-09-24', 266, 201],
            ['2026-10-22', 294, 201],
            ['2026-09-23', 265, 400],
            ['2026-10-23', 295, 400]
        ])('answers %s at %i days with %i', async ( probableDeliveryDate, _days, expected ) => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({
                notificationId,
                wasPregnantAtVaccination: 'YES',
                lastMenstruationDate: '2026-01-01',
                probableDeliveryDate
            });

            expect(response.status).toBe(expected);
            if( expected === 400 ) {
                expect(response.body.code).toBe('NOTIFPRG_001_DELIVERY_DATE_OUT_OF_RANGE');
            }
        });

        it('answers 400 with the SAME code when the delivery date is EARLIER than the menstruation', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({
                notificationId,
                wasPregnantAtVaccination: 'YES',
                lastMenstruationDate: '2026-06-01',
                probableDeliveryDate: '2026-01-01'
            });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFPRG_001_DELIVERY_DATE_OUT_OF_RANGE');
        });

        it('checks nothing when one of the two dates is missing, or both are', async () => {
            const onlyMenstruation = await notifyNewCase();
            expect(( await createPregnancy({
                notificationId: onlyMenstruation.notificationId,
                wasPregnantAtVaccination: 'YES',
                lastMenstruationDate: '2026-01-01'
            }) ).status).toBe(201);

            const onlyDelivery = await notifyNewCase();
            expect(( await createPregnancy({
                notificationId: onlyDelivery.notificationId,
                wasPregnantAtVaccination: 'YES',
                probableDeliveryDate: '2020-01-01'
            }) ).status).toBe(201);
        });

        it('answers 400 on a PUT that moves the delivery date out of range, with nothing else changing', async () => {
            const { pregnancyId } = await newPregnancy({
                lastMenstruationDate: '2026-01-01',
                probableDeliveryDate: '2026-09-24'
            });

            const response = await updatePregnancy(pregnancyId, { probableDeliveryDate: '2027-09-24' });
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFPRG_004_DELIVERY_DATE_OUT_OF_RANGE');
        });

        // Evaluated over the resulting state and not over the body: this PUT sends a single date
        it('answers 400 on a PUT that sends only the menstruation and breaks it against the STORED delivery date', async () => {
            const { pregnancyId } = await newPregnancy({
                lastMenstruationDate: '2026-01-01',
                probableDeliveryDate: '2026-09-24'
            });

            const response = await updatePregnancy(pregnancyId, { lastMenstruationDate: '2025-01-01' });
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('NOTIFPRG_004_DELIVERY_DATE_OUT_OF_RANGE');
        });

    });

    describe('wasPregnantAtVaccination', () => {

        it('answers 400 of the validator when it does not arrive', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId });

            expect(response.status).toBe(400);
        });

        it('answers 400 of the validator on an unknown value, not 500', async () => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'MAYBE' });

            expect(response.status).toBe(400);
        });

        // The answer is required, not a particular content
        it.each(['YES', 'NO', 'UNKNOWN', 'NOT_APPLICABLE', 'NO_ANSWER'])('answers 201 with %s', async ( value ) => {
            const { notificationId } = await notifyNewCase();
            const response = await createPregnancy({ notificationId, wasPregnantAtVaccination: value });

            expect(response.status).toBe(201);
        });

        it('is nullable on update: a PUT with null answers 200 and clears the column', async () => {
            const { pregnancyId } = await newPregnancy();
            const response = await updatePregnancy(pregnancyId, { wasPregnantAtVaccination: null });

            expect(response.status).toBe(200);
            expect(response.body.data.wasPregnantAtVaccination).toBeNull();
        });

    });

    describe('inherited visibility and state', () => {

        it('answers 404 for USER and ADMIN and 200 for SUPERADMIN when the NOTIFICATION is inactive', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            await deactivateNotification(notificationId);

            expect(( await getPregnancy(pregnancyId, 'USER') ).status).toBe(404);
            expect(( await getPregnancy(pregnancyId, 'ADMIN') ).status).toBe(404);
            expect(( await getPregnancy(pregnancyId, 'SUPERADMIN') ).status).toBe(200);

            expect(( await getByNotification(notificationId, 'USER') ).status).toBe(404);
            expect(( await getByNotification(notificationId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers the same when the PREGNANCY is inactive and the notification is active', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            await deletePregnancy(pregnancyId);

            expect(( await getPregnancy(pregnancyId, 'USER') ).status).toBe(404);
            expect(( await getPregnancy(pregnancyId, 'ADMIN') ).status).toBe(404);
            expect(( await getPregnancy(pregnancyId, 'SUPERADMIN') ).status).toBe(200);
            expect(( await getByNotification(notificationId, 'USER') ).status).toBe(404);
        });

        it('answers 404 on a create over an inactive notification, and over an unknown one', async () => {
            const { notificationId } = await notifyNewCase();
            await deactivateNotification(notificationId);

            const inactive = await createPregnancy({ notificationId, wasPregnantAtVaccination: 'YES' });
            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('NOTIFPRG_001_NOTIFICATION_NOT_FOUND');

            const unknown = await createPregnancy({ notificationId: unknownUuid, wasPregnantAtVaccination: 'YES' });
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('NOTIFPRG_001_NOTIFICATION_NOT_FOUND');
        });

        // No filter by notificationType, deliberately deviating from severeNotification
        it('answers 201 over a NON_SEVERE notification and over a SEVERE one', async () => {
            const nonSevere = await notifyNewCase(femaleItemId, 'NON_SEVERE');
            expect(( await createPregnancy({
                notificationId: nonSevere.notificationId, wasPregnantAtVaccination: 'YES'
            }) ).status).toBe(201);

            const severe = await notifyNewCase(femaleItemId, 'SEVERE');
            expect(( await createPregnancy({
                notificationId: severe.notificationId, wasPregnantAtVaccination: 'YES'
            }) ).status).toBe(201);
        });

        it('answers 409 when deactivating twice and when reactivating one already active', async () => {
            const { pregnancyId } = await newPregnancy();

            expect(( await deletePregnancy(pregnancyId) ).status).toBe(200);
            const twice = await deletePregnancy(pregnancyId);
            expect(twice.status).toBe(409);
            expect(twice.body.code).toBe('NOTIFPRG_005A_ALREADY_INACTIVE');

            expect(( await activatePregnancy(pregnancyId) ).status).toBe(200);
            const already = await activatePregnancy(pregnancyId);
            expect(already.status).toBe(409);
            expect(already.body.code).toBe('NOTIFPRG_005B_ALREADY_ACTIVE');
        });

        it('revalidates nothing on reactivation: a withdrawn notification still answers 200', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            await deletePregnancy(pregnancyId);
            await deactivateNotification(notificationId);

            expect(( await activatePregnancy(pregnancyId) ).status).toBe(200);
        });

        it('keeps the literal paths out of the reach of /:id', async () => {
            expect(( await getByNotification('algo') ).status).toBe(400);
            expect(( await activatePregnancy('algo') ).status).toBe(400);
            expect(( await purgePregnancy('algo') ).status).toBe(400);
        });

    });

    describe('the 006 and the absence of a listing', () => {

        it('returns an object and not a { count, rows }', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            const response = await getByNotification(notificationId);

            expect(response.status).toBe(200);
            expect(response.body.data.pregnancyId).toBe(pregnancyId);
            expect(response.body.data.count).toBeUndefined();
            expect(response.body.data.rows).toBeUndefined();
            expect(Array.isArray(response.body.data)).toBe(false);
        });

        it('tells the two 404 apart with distinct codes', async () => {
            const { notificationId } = await notifyNewCase();
            const withoutPregnancy = await getByNotification(notificationId);
            expect(withoutPregnancy.status).toBe(404);
            expect(withoutPregnancy.body.code).toBe('NOTIFPRG_006_NOT_FOUND');

            const unknownNotification = await getByNotification(unknownUuid);
            expect(unknownNotification.status).toBe(404);
            expect(unknownNotification.body.code).toBe('NOTIFPRG_006_NOTIFICATION_NOT_FOUND');
        });

        it('honours no pagination: limit and offset change nothing', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            const response = await request(app)
                .get(`/api/notification-pregnancies/notification/${ notificationId }?limit=0&offset=99`)
                .set(authHeader('USER'));

            expect(response.status).toBe(200);
            expect(response.body.data.pregnancyId).toBe(pregnancyId);
        });

    });

    describe('the physical delete and its cascade', () => {

        it('answers 409 when purging an active row, and 200 once it was withdrawn', async () => {
            const { pregnancyId } = await newPregnancy();

            const active = await purgePregnancy(pregnancyId);
            expect(active.status).toBe(409);
            expect(active.body.code).toBe('NOTIFPRG_005C_STILL_ACTIVE');
            expect(await NotificationPregnancy.findByPk(pregnancyId)).not.toBeNull();

            await deletePregnancy(pregnancyId);
            expect(( await purgePregnancy(pregnancyId) ).status).toBe(200);
            expect(await NotificationPregnancy.findByPk(pregnancyId)).toBeNull();
        });

        it('leaves ONE warn line with both complicationId, and both children die by cascade', async () => {
            const { pregnancyId } = await newPregnancy();
            const complicationIds = await addComplications(pregnancyId, ['Preeclampsia', 'Anemia']);
            await deletePregnancy(pregnancyId);

            expect(( await purgePregnancy(pregnancyId) ).status).toBe(200);

            const lines = logLines('dragged by the cascade of pregnancy').filter(line => line.includes(pregnancyId));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('2 notificationPregnancyComplication');
            expect(lines[0]).toContain(complicationIds[0]);
            expect(lines[0]).toContain(complicationIds[1]);
            expect(await countComplications(pregnancyId)).toBe(0);
        });

        it('leaves no such line when there are no complications, nor when the purge answers 409', async () => {
            const { pregnancyId } = await newPregnancy();
            await deletePregnancy(pregnancyId);
            await purgePregnancy(pregnancyId);
            expect(logLines('dragged by the cascade of pregnancy').filter(l => l.includes(pregnancyId))).toHaveLength(0);

            const blocked = await newPregnancy();
            await addComplications(blocked.pregnancyId, ['Preeclampsia']);
            expect(( await purgePregnancy(blocked.pregnancyId) ).status).toBe(409);
            expect(logLines('dragged by the cascade of pregnancy').filter(l => l.includes(blocked.pregnancyId))).toHaveLength(0);
            expect(await countComplications(blocked.pregnancyId)).toBe(1);
        });

        it('does not block the 005A: deactivating with live complications answers 200', async () => {
            const { pregnancyId } = await newPregnancy();
            await addComplications(pregnancyId, ['Preeclampsia', 'Anemia']);

            expect(( await deletePregnancy(pregnancyId) ).status).toBe(200);
            expect(await countComplications(pregnancyId)).toBe(2);
        });

        it('leaves ONE line with its pregnancyId when the NOTIFICATION is purged', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();

            await deactivateNotification(notificationId);
            const purged = await request(app)
                .delete(`/api/notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));
            expect(purged.status).toBe(200);

            const lines = logLines('notificationPregnancy row dragged').filter(line => line.includes(pregnancyId));
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('ESAVI-NOTIFCN-005C');
            expect(await NotificationPregnancy.findByPk(pregnancyId)).toBeNull();
        });

    });

    describe('the differential update', () => {

        it('writes nothing when the response of the GET is sent back whole', async () => {
            const { pregnancyId } = await newPregnancy({
                notes: 'Gestante de 32 semanas',
                wasPregnantAtEsavi: 'NO',
                hasComplications: 'UNKNOWN'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/notification-pregnancies',
                id: pregnancyId,
                model: NotificationPregnancy,
                role: 'USER'
            });
        });

        it('writes nothing on an empty body either', async () => {
            const { pregnancyId } = await newPregnancy({ notes: 'Gestante' });
            const before = await auditMethods(pregnancyId);
            const versionBefore = await rowVersion(pregnancyId);

            expect(( await updatePregnancy(pregnancyId, {}) ).status).toBe(200);

            expect(await auditMethods(pregnancyId)).toEqual(before);
            expect(await rowVersion(pregnancyId)).toBe(versionBefore);
        });

        it('adds ONE audit entry and bumps the version by 1 when a single field changes', async () => {
            const { pregnancyId } = await newPregnancy();
            const before = await auditMethods(pregnancyId);
            const versionBefore = await rowVersion(pregnancyId) ?? 0;

            expect(( await updatePregnancy(pregnancyId, { notes: 'Primera gestación' }) ).status).toBe(200);

            const after = await auditMethods(pregnancyId);
            expect(after).toHaveLength(before.length + 1);
            expect(after[after.length - 1]).toBe('ESAVI-NOTIFPRG-004');
            expect(await rowVersion(pregnancyId)).toBe(versionBefore + 1);
        });

        it('ignores a different notificationId in silence: 200, unchanged and not a change', async () => {
            const { pregnancyId, notificationId } = await newPregnancy();
            const before = await auditMethods(pregnancyId);

            const response = await updatePregnancy(pregnancyId, { notificationId: unknownUuid });

            expect(response.status).toBe(200);
            expect(response.body.data.notificationId).toBe(notificationId);
            expect(await auditMethods(pregnancyId)).toEqual(before);
        });

        it('writes nothing when notes only differ in padding, and clears them on an empty string', async () => {
            const { pregnancyId } = await newPregnancy({ notes: 'Gestante de 32 semanas' });
            const before = await auditMethods(pregnancyId);

            expect(( await updatePregnancy(pregnancyId, { notes: '  Gestante de 32 semanas  ' }) ).status).toBe(200);
            expect(await auditMethods(pregnancyId)).toEqual(before);

            const cleared = await updatePregnancy(pregnancyId, { notes: '' });
            expect(cleared.status).toBe(200);
            expect(cleared.body.data.notes).toBeNull();
        });

        // null and NO_ANSWER are different data: one is "the form did not collect it", the other a
        // deliberate answer from the notifier
        it('writes when a tri-state moves from null to NO_ANSWER, and when it moves back', async () => {
            const { pregnancyId } = await newPregnancy();
            const before = await auditMethods(pregnancyId);

            expect(( await updatePregnancy(pregnancyId, { hasComplications: 'NO_ANSWER' }) ).status).toBe(200);
            expect(await auditMethods(pregnancyId)).toHaveLength(before.length + 1);

            expect(( await updatePregnancy(pregnancyId, { hasComplications: null }) ).status).toBe(200);
            expect(await auditMethods(pregnancyId)).toHaveLength(before.length + 2);
        });

        it('leaves the three tri-states and the two dates untouched when only notes change', async () => {
            const { pregnancyId } = await newPregnancy({
                wasPregnantAtEsavi: 'NO',
                hasComplications: 'UNKNOWN',
                lastMenstruationDate: '2026-01-01',
                probableDeliveryDate: '2026-09-24'
            });

            const response = await updatePregnancy(pregnancyId, { notes: 'Otra nota' });

            expect(response.status).toBe(200);
            expect(response.body.data.wasPregnantAtVaccination).toBe('YES');
            expect(response.body.data.wasPregnantAtEsavi).toBe('NO');
            expect(response.body.data.hasComplications).toBe('UNKNOWN');
            expect(response.body.data.lastMenstruationDate).toBe('2026-01-01');
            expect(response.body.data.probableDeliveryDate).toBe('2026-09-24');
        });

        // The first half of the F12 criterion in its own form. The second half — a taken code
        // answering 409 — does not apply: this table has no code, and its only UNIQUE is over
        // notificationId, which is immutable
        it('answers 404 on a PUT whose notification is inactive, even with an identical body', async () => {
            const { pregnancyId, notificationId } = await newPregnancy({ notes: 'Gestante' });
            await deactivateNotification(notificationId);

            const response = await updatePregnancy(pregnancyId, { notes: 'Gestante' });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('NOTIFPRG_004_NOT_FOUND');
        });

    });

    describe('the errors of the id', () => {

        it('answers 404 with the code of its own operation on every unknown id', async () => {
            expect(( await getPregnancy(unknownUuid) ).body.code).toBe('NOTIFPRG_003_NOT_FOUND');
            expect(( await updatePregnancy(unknownUuid, { notes: 'x' }) ).body.code).toBe('NOTIFPRG_004_NOT_FOUND');
            expect(( await deletePregnancy(unknownUuid) ).body.code).toBe('NOTIFPRG_005A_NOT_FOUND');
            expect(( await activatePregnancy(unknownUuid) ).body.code).toBe('NOTIFPRG_005B_NOT_FOUND');
            expect(( await purgePregnancy(unknownUuid) ).body.code).toBe('NOTIFPRG_005C_NOT_FOUND');
        });

        it('answers 400 of the validator on an id that is not a UUID', async () => {
            expect(( await getPregnancy('algo') ).status).toBe(400);
            expect(( await updatePregnancy('algo', { notes: 'x' }) ).status).toBe(400);
            expect(( await deletePregnancy('algo') ).status).toBe(400);
        });

    });

});
