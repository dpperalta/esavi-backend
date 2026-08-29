import request from 'supertest';
import { EsaviCase, HealthFacility, Notification, Patient, SevereNotification } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the five severeNotification operations of SPEC F13. It walks
 * the entity end to end — create, read by id, read by case, update, drag, purge —
 * and covers what cannot be checked by hand reliably.
 *
 * This is the first entity of the repository whose table has no isActive column:
 * its lifecycle is governed entirely by its header, so it exposes no 005A or 005B
 * and no listing at all. What the suite therefore has to prove is different from
 * every suite before it: that the visibility is inherited from notification.isActive
 * rather than owned; that deletedAt is the only status mark the row carries, moved
 * by the two operations that deactivate the header and cleared by the one that
 * brings it back — the first upward cascade of the repository; and that the purge
 * is guarded by that seal, because the isActive check of purgeEntityService is
 * inert here and would otherwise let every row be destroyed on sight.
 *
 * Plus the pregnancy rule, evaluated over the resulting state on update and not
 * over the body, and the tri-state of the five answerOption fields, where null is
 * a value of its own and never becomes NO_ANSWER.
 */
describe('severeNotification contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // Every case is minted fresh: the chain case -> notification -> detail is one to one on
    // both hops, so two tests cannot share one
    const createCaseFixture = async (): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Severe ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`SV${ caseCounter }${ suffix }`),
            healthSystemCode: `SV${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `SV${ caseCounter }${ suffix }`,
            name: `Severe ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `SV-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // A notification of the given type over a brand new case. The severe detail needs a SEVERE
    // header, which is the only fixture precondition of the whole suite
    const notifyNewCase = async (
        notificationType: string = 'SEVERE'
    ): Promise<{ notificationId: string, caseId: string }> => {
        const caseId = await createCaseFixture();
        const created = await request(app)
            .post('/api/notifications')
            .set(authHeader('USER'))
            .send({ caseId, notificationType, esaviDescription: 'Fever after the dose' });
        return { notificationId: created.body.data.notificationId, caseId };
    };

    const createDetail = ( payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).post('/api/severe-notifications').set(authHeader(role)).send(payload);

    const getDetail = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/severe-notifications/${ id }`).set(authHeader(role));

    const getDetailByCase = ( caseId: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/severe-notifications/case/${ caseId }`).set(authHeader(role));

    const updateDetail = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/severe-notifications/${ id }`).set(authHeader(role)).send(payload);

    const purgeDetail = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).delete(`/api/severe-notifications/purge/${ id }`).set(authHeader(role));

    const deactivateNotification = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/notifications/${ id }`).set(authHeader(role));

    const activateNotification = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/notifications/activate/${ id }`).set(authHeader(role));

    // A severe detail over a brand new case, which is the only way to get one
    const detailOverNewCase = async (
        payload: Record<string, unknown> = {}
    ): Promise<{ notificationId: string, caseId: string }> => {
        const { notificationId, caseId } = await notifyNewCase();
        await createDetail({ notificationId, ...payload });
        return { notificationId, caseId };
    };

    // deletedAt and appDetails read from the row itself: the drag is checked where it is written
    const readRow = async ( id: string ) => {
        const row = await SevereNotification.findByPk(id);
        return {
            deletedAt: row!.getDataValue('deletedAt') as Date | null,
            appDetails: row!.getDataValue('appDetails') as { method: string }[],
            updatedAt: row!.getDataValue('updatedAt') as Date | null,
            version: ( row!.getDataValue('sysDetails') as { version?: number } | null )?.version
        };
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('the full walkthrough', () => {

        it('creates, reads by id, reads by case, updates, is dragged and is purged', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            const created = await createDetail({
                notificationId,
                hasAllergyToMedications: 'YES',
                notes: '   penicillin   '
            });
            expect(created.status).toBe(201);
            expect(created.body.data.notes).toBe('penicillin');

            const byId = await getDetail(notificationId);
            expect(byId.status).toBe(200);
            expect(byId.body.data.notificationId).toBe(notificationId);

            const byCase = await getDetailByCase(caseId);
            expect(byCase.status).toBe(200);
            expect(byCase.body.data.notificationId).toBe(notificationId);

            const updated = await updateDetail(notificationId, { hasAllergyToMedications: 'NO' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.hasAllergyToMedications).toBe('NO');

            // Retiring the detail is retiring its header: there is no other way
            expect(( await purgeDetail(notificationId) ).status).toBe(409);
            expect(( await deactivateNotification(notificationId) ).status).toBe(200);

            const purged = await purgeDetail(notificationId);
            expect(purged.status).toBe(200);
            expect(purged.body).not.toHaveProperty('data');
            expect(await SevereNotification.findByPk(notificationId)).toBeNull();

            // The header it belonged to survives: the foreign key runs the other way
            expect(await Notification.findByPk(notificationId)).not.toBeNull();
        });

    });

    describe('ESAVI-SEVNOT-001 — create', () => {

        it('creates the detail with only the notificationId and answers 201 with the full shape', async () => {
            const { notificationId, caseId } = await notifyNewCase();

            const response = await createDetail({ notificationId });
            const data = response.body.data;

            expect(response.status).toBe(201);
            expect(data.notificationId).toBe(notificationId);
            // The five tri-state fields are born null, never NO_ANSWER and never false
            for( const field of [
                'hasPreviousEventHistory', 'hasAllergyToOtherVaccines', 'hasAllergyToMedications',
                'hasAllergyToPreviousSameVaccine', 'hasPregnancyComplications'
            ] ) {
                expect(data[field]).toBeNull();
            }
            expect(data.deletedAt).toBeNull();
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-SEVNOT-001');
            expect(data.notification).toEqual(expect.objectContaining({
                notificationId,
                notificationType: 'SEVERE',
                isActive: true
            }));
            expect(data.notification.case).toEqual(expect.objectContaining({ caseId, eventDate: '2024-05-04' }));
        });

        it('never exposes sysDetails nor an isActive of its own', async () => {
            const { notificationId } = await notifyNewCase();

            const response = await createDetail({ notificationId });

            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data).not.toHaveProperty('isActive');
            expect(response.body.data.notification).not.toHaveProperty('sysDetails');
        });

        it('trims the two free texts', async () => {
            const { notificationId } = await notifyNewCase();

            const response = await createDetail({
                notificationId,
                hasPregnancyComplications: 'YES',
                pregnancyComplicationsDescription: '   Preeclampsia   ',
                notes: '   Needs follow up   '
            });

            expect(response.body.data.pregnancyComplicationsDescription).toBe('Preeclampsia');
            expect(response.body.data.notes).toBe('Needs follow up');
        });

        it('answers 409 when the notification already has a severe detail', async () => {
            const { notificationId } = await detailOverNewCase();

            const response = await createDetail({ notificationId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('SEVNOT_001_ALREADY_EXISTS');
            expect(response.body.message).toContain(notificationId);
        });

        it('answers 409 and not 400 when the notification is NON_SEVERE', async () => {
            const { notificationId } = await notifyNewCase('NON_SEVERE');

            const response = await createDetail({ notificationId });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('SEVNOT_001_NOTIFICATION_NOT_SEVERE');
            expect(response.body.message).toContain(notificationId);
            expect(await SevereNotification.findByPk(notificationId)).toBeNull();
        });

        it('answers 404 over an inactive notification and over an unknown one', async () => {
            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);
            await purgeDetail(notificationId);

            const overInactive = await createDetail({ notificationId });
            expect(overInactive.status).toBe(404);
            expect(overInactive.body.code).toBe('SEVNOT_001_NOTIFICATION_NOT_FOUND');

            const overUnknown = await createDetail({ notificationId: unknownUuid });
            expect(overUnknown.status).toBe(404);
            expect(overUnknown.body.code).toBe('SEVNOT_001_NOTIFICATION_NOT_FOUND');
        });

        it('answers 400 from validateFields for a value outside the ENUM, never 500', async () => {
            const { notificationId } = await notifyNewCase();

            const response = await createDetail({ notificationId, hasAllergyToMedications: 'MAYBE' });

            expect(response.status).toBe(400);
            expect(response.body.ok).toBe(false);
            expect(response.body.errors).toContain('Has Allergy To Medications must be one of');
        });

        it('requires the notificationId, which the database does not generate', async () => {
            const response = await createDetail({ notes: 'orphan' });
            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-SEVNOT-003 — get by id', () => {

        it('answers 404 for an unknown id', async () => {
            const response = await getDetail(unknownUuid);

            expect(response.status).toBe(404);
            expect(response.body.code).toBe('SEVNOT_003_NOT_FOUND');
        });

        it('hides the detail of an inactive header from USER and ADMIN, and shows it to SUPERADMIN', async () => {
            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);

            expect(( await getDetail(notificationId, 'USER') ).status).toBe(404);
            expect(( await getDetail(notificationId, 'ADMIN') ).status).toBe(404);

            const asSuperAdmin = await getDetail(notificationId, 'SUPERADMIN');
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.notification.isActive).toBe(false);
        });

        it('gives that 404 the same code and message as a missing row: the cause is not distinguished', async () => {
            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);

            const hidden = await getDetail(notificationId);
            const missing = await getDetail(unknownUuid);

            expect(hidden.body.code).toBe(missing.body.code);
            expect(hidden.body.message).toBe(missing.body.message);
        });

        it('still answers 200 for a sealed deletedAt under an active header', async () => {
            const { notificationId } = await detailOverNewCase();

            // The normal flow does not produce this state — the drag always deactivates the
            // header — so it is written directly, which is how the spec says it could appear
            await SevereNotification.update({ deletedAt: new Date() }, { where: { notificationId } });

            const response = await getDetail(notificationId);
            expect(response.status).toBe(200);
            expect(response.body.data.deletedAt).not.toBeNull();
            expect(response.body.data.notification.isActive).toBe(true);
        });

    });

    describe('ESAVI-SEVNOT-006 — get by case', () => {

        it('returns the record itself, not { count, rows }', async () => {
            const { caseId, notificationId } = await detailOverNewCase();

            const response = await getDetailByCase(caseId);

            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(false);
            expect(response.body.data).not.toHaveProperty('count');
            expect(response.body.data).not.toHaveProperty('rows');
            expect(response.body.data.notificationId).toBe(notificationId);
            expect(response.body.data.notification.case.caseId).toBe(caseId);
        });

        it('tells the three broken links apart with three distinct codes', async () => {
            const withoutNotification = await createCaseFixture();
            const { caseId: withoutDetail } = await notifyNewCase();

            const noCase = await getDetailByCase(unknownUuid);
            expect(noCase.status).toBe(404);
            expect(noCase.body.code).toBe('SEVNOT_006_CASE_NOT_FOUND');

            const noNotification = await getDetailByCase(withoutNotification);
            expect(noNotification.status).toBe(404);
            expect(noNotification.body.code).toBe('SEVNOT_006_NOTIFICATION_NOT_FOUND');

            const noDetail = await getDetailByCase(withoutDetail);
            expect(noDetail.status).toBe(404);
            expect(noDetail.body.code).toBe('SEVNOT_006_NOT_FOUND');

            expect(new Set([noCase.body.code, noNotification.body.code, noDetail.body.code]).size).toBe(3);
        });

        it('applies the same inherited visibility as 003', async () => {
            const { caseId, notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);

            expect(( await getDetailByCase(caseId) ).status).toBe(404);
            expect(( await getDetailByCase(caseId, 'SUPERADMIN') ).status).toBe(200);
        });

        it('answers 400 for a caseId that is not a UUID, so /case is not captured as an :id', async () => {
            const response = await getDetailByCase('not-a-uuid');
            expect(response.status).toBe(400);
        });

    });

    describe('ESAVI-SEVNOT-004 — update', () => {

        it('answers 404 for an unknown id and for a detail under an inactive header', async () => {
            expect(( await updateDetail(unknownUuid, { notes: 'x' }) ).body.code).toBe('SEVNOT_004_NOT_FOUND');

            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);

            expect(( await updateDetail(notificationId, { notes: 'blocked' }) ).status).toBe(404);
            expect(( await updateDetail(notificationId, { notes: 'allowed' }, 'SUPERADMIN') ).status).toBe(200);
        });

        it('ignores a different notificationId in the body and answers 200', async () => {
            const { notificationId } = await detailOverNewCase();

            const response = await updateDetail(notificationId, {
                notificationId: unknownUuid,
                notes: 'moved?'
            });

            expect(response.status).toBe(200);
            expect(response.body.data.notificationId).toBe(notificationId);
            expect(await SevereNotification.findByPk(notificationId)).not.toBeNull();
            expect(await SevereNotification.findByPk(unknownUuid)).toBeNull();
        });

        it('keeps null and NO_ANSWER apart in both directions', async () => {
            const { notificationId } = await detailOverNewCase({ hasPreviousEventHistory: 'NO_ANSWER' });

            const toNull = await updateDetail(notificationId, { hasPreviousEventHistory: null });
            expect(toNull.body.data.hasPreviousEventHistory).toBeNull();
            expect(toNull.body.data.appDetails).toHaveLength(2);

            const back = await updateDetail(notificationId, { hasPreviousEventHistory: 'NO_ANSWER' });
            expect(back.body.data.hasPreviousEventHistory).toBe('NO_ANSWER');
            expect(back.body.data.appDetails).toHaveLength(3);
        });

    });

    describe('the pregnancy rule', () => {

        it('requires the description under YES, on create and on update', async () => {
            const { notificationId } = await notifyNewCase();

            const missing = await createDetail({ notificationId, hasPregnancyComplications: 'YES' });
            expect(missing.status).toBe(400);
            expect(missing.body.code).toBe('SEVNOT_001_PREGNANCY_DESCRIPTION_REQUIRED');

            const blank = await createDetail({
                notificationId,
                hasPregnancyComplications: 'YES',
                pregnancyComplicationsDescription: '   '
            });
            expect(blank.status).toBe(400);
            expect(blank.body.code).toBe('SEVNOT_001_PREGNANCY_DESCRIPTION_REQUIRED');

            // Neither attempt left a row behind
            expect(await SevereNotification.findByPk(notificationId)).toBeNull();

            const { notificationId: other } = await detailOverNewCase({
                hasPregnancyComplications: 'YES',
                pregnancyComplicationsDescription: 'Preeclampsia'
            });
            const clearing = await updateDetail(other, { pregnancyComplicationsDescription: null });
            expect(clearing.status).toBe(400);
            expect(clearing.body.code).toBe('SEVNOT_004_PREGNANCY_DESCRIPTION_REQUIRED');
        });

        it('rejects the description when the answer is not YES, instead of ignoring it', async () => {
            const { notificationId } = await notifyNewCase();

            const underNo = await createDetail({
                notificationId,
                hasPregnancyComplications: 'NO',
                pregnancyComplicationsDescription: 'Bleeding'
            });
            expect(underNo.status).toBe(400);
            expect(underNo.body.code).toBe('SEVNOT_001_PREGNANCY_DESCRIPTION_NOT_ALLOWED');

            const underNull = await createDetail({
                notificationId,
                pregnancyComplicationsDescription: 'Bleeding'
            });
            expect(underNull.status).toBe(400);
            expect(underNull.body.code).toBe('SEVNOT_001_PREGNANCY_DESCRIPTION_NOT_ALLOWED');
        });

        it('is evaluated over the resulting state and not over the body', async () => {
            const { notificationId } = await detailOverNewCase({
                hasPregnancyComplications: 'YES',
                pregnancyComplicationsDescription: 'Preeclampsia'
            });

            // Moving out of YES without clearing the description would orphan the text
            const orphaning = await updateDetail(notificationId, { hasPregnancyComplications: 'NO' });
            expect(orphaning.status).toBe(400);
            expect(orphaning.body.code).toBe('SEVNOT_004_PREGNANCY_DESCRIPTION_NOT_ALLOWED');

            const clearing = await updateDetail(notificationId, {
                hasPregnancyComplications: 'NO',
                pregnancyComplicationsDescription: null
            });
            expect(clearing.status).toBe(200);
            expect(clearing.body.data.hasPregnancyComplications).toBe('NO');
            expect(clearing.body.data.pregnancyComplicationsDescription).toBeNull();
        });

        it('lets a PUT touching only notes through, because the stored state already satisfies it', async () => {
            const { notificationId } = await detailOverNewCase({
                hasPregnancyComplications: 'YES',
                pregnancyComplicationsDescription: 'Preeclampsia'
            });

            const response = await updateDetail(notificationId, { notes: 'follow up next week' });

            expect(response.status).toBe(200);
            expect(response.body.data.pregnancyComplicationsDescription).toBe('Preeclampsia');
        });

    });

    describe('the differential update', () => {

        it('writes nothing when the GET response is sent back whole', async () => {
            const { notificationId } = await detailOverNewCase({
                hasAllergyToMedications: 'YES',
                notes: 'watch closely'
            });

            await expectPutOfGetResponseWritesNothing({
                path: '/api/severe-notifications',
                id: notificationId,
                model: SevereNotification,
                role: 'USER'
            });
        });

        it('writes nothing for an empty body, nor for one differing only in blanks', async () => {
            const { notificationId } = await detailOverNewCase({ notes: 'watch closely' });
            const before = await readRow(notificationId);

            expect(( await updateDetail(notificationId, {}) ).status).toBe(200);
            expect(( await updateDetail(notificationId, { notes: '   watch closely   ' }) ).status).toBe(200);

            const after = await readRow(notificationId);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
            expect(after.version).toBe(before.version);
            expect(after.updatedAt).toEqual(before.updatedAt);
        });

        it('adds one entry and bumps the version by 1 when a single field changes', async () => {
            const { notificationId } = await detailOverNewCase();
            const before = await readRow(notificationId);

            const response = await updateDetail(notificationId, { hasAllergyToOtherVaccines: 'UNKNOWN' });
            expect(response.status).toBe(200);

            const after = await readRow(notificationId);
            expect(after.appDetails).toHaveLength(before.appDetails.length + 1);
            expect(after.appDetails[after.appDetails.length - 1].method).toBe('ESAVI-SEVNOT-004');
            expect(after.version).toBe(( before.version ?? 0 ) + 1);
            expect(after.updatedAt).not.toEqual(before.updatedAt);
        });

    });

    describe('the drag from the header', () => {

        it('seals deletedAt on 005A and clears it on 005B, preserving the history', async () => {
            const { notificationId } = await detailOverNewCase();
            expect(( await readRow(notificationId) ).deletedAt).toBeNull();

            await deactivateNotification(notificationId);
            const sealed = await readRow(notificationId);
            expect(sealed.deletedAt).not.toBeNull();
            expect(sealed.appDetails).toHaveLength(2);
            expect(sealed.appDetails[1].method).toBe('ESAVI-NOTIFCN-005A');

            await activateNotification(notificationId);
            const cleared = await readRow(notificationId);
            expect(cleared.deletedAt).toBeNull();
            expect(cleared.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-SEVNOT-001',
                'ESAVI-NOTIFCN-005A',
                'ESAVI-NOTIFCN-005B'
            ]);
        });

        it('never writes an ESAVI-SEVNOT-005 method: the audit says who dragged it', async () => {
            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);
            await activateNotification(notificationId);

            const { appDetails } = await readRow(notificationId);
            expect(appDetails.some(entry => /^ESAVI-SEVNOT-005/.test(entry.method))).toBe(false);
        });

        it('does not fail on a notification with no detail', async () => {
            const { notificationId } = await notifyNewCase();

            expect(( await deactivateNotification(notificationId) ).status).toBe(200);
            expect(( await activateNotification(notificationId) ).status).toBe(200);
            expect(await SevereNotification.findByPk(notificationId)).toBeNull();
        });

    });

    describe('ESAVI-SEVNOT-005C — purge', () => {

        it('answers 409 for a detail that was never dragged, and the row survives', async () => {
            const { notificationId } = await detailOverNewCase();

            const response = await purgeDetail(notificationId);

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('SEVNOT_005C_NOT_DELETED');
            expect(response.body.message).toContain(notificationId);
            expect(await SevereNotification.findByPk(notificationId)).not.toBeNull();
        });

        it('answers 404 when repeated, and 403 for an ADMIN', async () => {
            const { notificationId } = await detailOverNewCase();
            await deactivateNotification(notificationId);

            const asAdmin = await purgeDetail(notificationId, 'ADMIN');
            expect(asAdmin.status).toBe(403);
            expect(await SevereNotification.findByPk(notificationId)).not.toBeNull();

            expect(( await purgeDetail(notificationId) ).status).toBe(200);

            const again = await purgeDetail(notificationId);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('SEVNOT_005C_NOT_FOUND');
        });

    });

});
