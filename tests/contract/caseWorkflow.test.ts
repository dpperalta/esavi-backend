import request from 'supertest';
import { app } from '../../src/app';
import { CaseWorkflow, CatalogItem, CatalogType, EsaviCase, HealthFacility, Patient } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';

/**
 * Contract suite for the eleven HTTP operations of `caseWorkflow` (SPEC F44).
 *
 * The entity has a shape unlike any other of the repository, and the suite is built around its
 * two absences: there is **no 001** — the row is born inside `ESAVI-CASE-001` — and **no 004**,
 * because no column of the table is written by a human. It also has no 005C: `caseWorkflow` is
 * inside the `preventPhysicalDelete` loop.
 *
 * The core of the file is the walkthrough: create the case, classify, notify, investigate,
 * final-classify, close and reopen, checking the status and the stamps at every jump.
 *
 * The fixtures build their case straight on the model and open its workflow with
 * `seedCaseWorkflow`, which is what a case created through `POST /api/esavi-cases` gets inside
 * its own transaction. Without that row every stage POST answers 404 `CASEFLOW_012_NOT_FOUND`,
 * which is exactly what a case created BEFORE this spec does.
 */
describe('caseWorkflow contract', () => {

    const suffix = Date.now().toString(36);
    let counter = 0;

    // errorHandler logs every error it handles, and most of these tests trigger errors on
    // purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    // ---------------------------------------------------------------------------------------
    // Fixtures
    // ---------------------------------------------------------------------------------------

    /** A case with its workflow row open in OPEN, the state POST /api/esavi-cases leaves. */
    const createCaseFixture = async (): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Workflow ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CW${ counter }${ suffix }`),
            healthSystemCode: `CW${ counter }${ suffix }`
        });
        const facility = await HealthFacility.create({
            localCode: `CW${ counter }${ suffix }`,
            name: `Workflow ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CW-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10)
        });
        const caseId = esaviCase.getDataValue('caseId');
        await seedCaseWorkflow(caseId);
        return caseId;
    };

    /** The same, without the workflow row: a case from before SPEC F44. */
    const createLegacyCaseFixture = async (): Promise<string> => {
        counter += 1;
        const patient = await Patient.create({
            firstName: esaviCrypt(`Legacy ${ counter }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CL${ counter }${ suffix }`),
            healthSystemCode: `CL${ counter }${ suffix }`
        });
        const facility = await HealthFacility.create({
            localCode: `CL${ counter }${ suffix }`,
            name: `Legacy ${ counter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CL-${ suffix }-${ counter }`,
            reportDate: new Date().toISOString().slice(0, 10)
        });
        return esaviCase.getDataValue('caseId');
    };

    const workflowIdOf = async ( caseId: string ): Promise<string> => {
        const workflow = await CaseWorkflow.findOne({ where: { caseId } });
        return workflow!.getDataValue('caseWorkflowId');
    };

    const statusIdOf = async ( code: string ): Promise<string> => {
        const catalogType = await CatalogType.findOne({ where: { code: 'caseWorkflowStatus' } });
        const item = await CatalogItem.findOne({
            where: { code, catalogTypeId: catalogType!.getDataValue('catalogTypeId') }
        });
        return item!.getDataValue('catalogItemId');
    };

    // The four stage POSTs. A serious classification is built from a severity criterion and not
    // from a bare isSeriousEvent: SPEC F09 derives the flag from the criteria and rejects a true
    // with nothing behind it
    const classify = async ( caseId: string, serious = false ) =>
        request(app).post('/api/classifications').set(await authHeader('USER'))
            .send(serious ? { caseId, causedHospitalization: true } : { caseId, isSeriousEvent: false });

    const notify = async ( caseId: string, requestInvestigation = false ) =>
        request(app).post('/api/notifications').set(await authHeader('USER'))
            .send({ caseId, notificationType: 'SEVERE', esaviDescription: `Event ${ suffix }`, requestInvestigation });

    const investigate = async ( caseId: string ) =>
        request(app).post('/api/investigations').set(await authHeader('USER')).send({ caseId });

    const finalClassify = async ( caseId: string ) =>
        request(app).post('/api/final-classifications').set(await authHeader('USER')).send({ caseId });

    // The transitions
    const getByCase = async ( caseId: string, role = 'USER' ) =>
        request(app).get(`/api/case-workflows/case/${ caseId }`).set(await authHeader(role as never));

    const completeStage = async ( caseId: string, stage: string ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/complete-stage`)
            .set(await authHeader('USER')).send({ stage });

    const close = async ( caseId: string, role = 'USER' ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/close`).set(await authHeader(role as never));

    const reopen = async ( caseId: string, role = 'ADMIN' ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/reopen`).set(await authHeader(role as never));

    const requestValidation = async ( caseId: string ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/request-validation`).set(await authHeader('USER'));

    const resolveValidation = async ( caseId: string ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/resolve-validation`).set(await authHeader('USER'));

    /** A case that satisfies the two always-required preconditions of 008. */
    const createClosableCase = async (): Promise<string> => {
        const caseId = await createCaseFixture();
        await classify(caseId);
        await notify(caseId);
        return caseId;
    };

    const missingUuid = '9f1c2b3a-4d5e-4f60-8a91-2b3c4d5e6f70';
    const stageKeys = ['classification', 'notification', 'investigation', 'finalClassification'];

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // ---------------------------------------------------------------------------------------
    // The walkthrough
    // ---------------------------------------------------------------------------------------

    describe('walkthrough — create, classify, notify, investigate, final-classify, close, reopen', () => {

        it('walks the whole file checking the status and the stamps at every jump', async () => {
            const caseId = await createCaseFixture();

            // The case is born in OPEN with openedAt stamped and no stage started
            const opened = await getByCase(caseId);
            expect(opened.status).toBe(200);
            expect(opened.body.data.status.code).toBe('OPEN');
            expect(opened.body.data.openedAt).not.toBeNull();
            expect(opened.body.data.closedAt).toBeNull();
            expect(opened.body.data.reopenCount).toBe(0);
            expect(opened.body.data.totalDurationMinutes).toBeNull();
            for( const key of stageKeys ) {
                expect(opened.body.data.stages[key]).toEqual({
                    exists: false, id: null, startedAt: null, endedAt: null, durationMinutes: null
                });
            }

            // Classification: status moves and classificationStartedAt is stamped
            const classification = await classify(caseId, true);
            expect(classification.status).toBe(201);
            const afterClassification = await getByCase(caseId);
            expect(afterClassification.body.data.status.code).toBe('IN_CLASSIFICATION');
            expect(afterClassification.body.data.stages.classification.exists).toBe(true);
            expect(afterClassification.body.data.stages.classification.id)
                .toBe(classification.body.data.classificationId);
            expect(afterClassification.body.data.stages.classification.startedAt).not.toBeNull();
            expect(afterClassification.body.data.stages.classification.endedAt).toBeNull();

            // Notification: the previous stage is auto-sealed with THE SAME instant
            const notification = await notify(caseId, true);
            expect(notification.status).toBe(201);
            const afterNotification = await getByCase(caseId);
            expect(afterNotification.body.data.status.code).toBe('IN_NOTIFICATION');
            expect(afterNotification.body.data.stages.classification.endedAt)
                .toBe(afterNotification.body.data.stages.notification.startedAt);
            expect(typeof afterNotification.body.data.stages.classification.durationMinutes).toBe('number');
            expect(afterNotification.body.data.stages.notification.id)
                .toBe(notification.body.data.notificationId);

            // Investigation
            const investigation = await investigate(caseId);
            expect(investigation.status).toBe(201);
            const afterInvestigation = await getByCase(caseId);
            expect(afterInvestigation.body.data.status.code).toBe('IN_INVESTIGATION');
            expect(afterInvestigation.body.data.stages.investigation.id)
                .toBe(investigation.body.data.investigationId);

            // Final classification
            const finalClassification = await finalClassify(caseId);
            expect(finalClassification.status).toBe(201);
            const afterFinal = await getByCase(caseId);
            expect(afterFinal.body.data.status.code).toBe('IN_FINAL_CLASSIFICATION');
            expect(afterFinal.body.data.stages.finalClassification.id)
                .toBe(finalClassification.body.data.finalClassificationId);
            // The four ids match the primary keys the four POSTs returned
            for( const key of stageKeys ) {
                expect(afterFinal.body.data.stages[key].exists).toBe(true);
                expect(afterFinal.body.data.stages[key].id).not.toBeNull();
            }

            // Close: the last open stage is sealed and totalDurationMinutes stops being null
            const closed = await close(caseId);
            expect(closed.status).toBe(200);
            expect(closed.body.data.status.code).toBe('CLOSED');
            expect(closed.body.data.closedAt).not.toBeNull();
            expect(closed.body.data.previousStatus).toBeNull();
            expect(closed.body.data.stages.finalClassification.endedAt).not.toBeNull();
            expect(typeof closed.body.data.totalDurationMinutes).toBe('number');

            // Reopen: REOPENED, reopenCount 1, and closedAt preserved
            const reopened = await reopen(caseId);
            expect(reopened.status).toBe(200);
            expect(reopened.body.data.status.code).toBe('REOPENED');
            expect(reopened.body.data.reopenCount).toBe(1);
            expect(reopened.body.data.lastReopenedAt).not.toBeNull();
            expect(reopened.body.data.closedAt).toBe(closed.body.data.closedAt);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 002A / 002B — listings
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-002A / 002B — listings', () => {

        it('002A answers { count, rows } with every row in the full shape', async () => {
            const caseId = await createCaseFixture();
            const res = await request(app).get('/api/case-workflows').set(await authHeader('USER'));

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.data).toHaveProperty('count');
            expect(Array.isArray(res.body.data.rows)).toBe(true);

            const row = res.body.data.rows.find(( item: { caseId: string } ) => item.caseId === caseId);
            expect(row).toBeDefined();
            expect(row.status.code).toBe('OPEN');
            expect(row.sysDetails).toBeUndefined();
            for( const key of stageKeys ) {
                expect(row.stages[key].exists).toBe(row.stages[key].id !== null);
            }
        });

        it('filters by caseId, by statusCode and by the openedAt range', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId);

            const byCase = await request(app).get(`/api/case-workflows?caseId=${ caseId }`)
                .set(await authHeader('USER'));
            expect(byCase.body.data.count).toBe(1);

            const byStatus = await request(app)
                .get(`/api/case-workflows?caseId=${ caseId }&statusCode=IN_CLASSIFICATION`)
                .set(await authHeader('USER'));
            expect(byStatus.body.data.count).toBe(1);

            const otherStatus = await request(app)
                .get(`/api/case-workflows?caseId=${ caseId }&statusCode=CLOSED`)
                .set(await authHeader('USER'));
            expect(otherStatus.body.data.count).toBe(0);

            const future = await request(app).get('/api/case-workflows?openedFrom=2099-01-01')
                .set(await authHeader('USER'));
            expect(future.body.data.count).toBe(0);
        });

        it('answers 404 for a statusCode that is not in the catalog', async () => {
            const res = await request(app).get('/api/case-workflows?statusCode=NOT_A_STATUS')
                .set(await authHeader('USER'));
            expect(res.status).toBe(404);
            expect(res.body.code).toBe('CASEFLOW_002_STATUS_NOT_FOUND');
        });

        it('002B needs ADMIN and includes the inactive rows the 002A hides', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));

            expect((await request(app).get('/api/case-workflows/admin').set(await authHeader('USER'))).status).toBe(403);

            const publicList = await request(app).get(`/api/case-workflows?caseId=${ caseId }`)
                .set(await authHeader('USER'));
            expect(publicList.body.data.count).toBe(0);

            const adminList = await request(app).get(`/api/case-workflows/admin?caseId=${ caseId }`)
                .set(await authHeader('ADMIN'));
            expect(adminList.body.data.count).toBe(1);
            expect(adminList.body.data.rows[0].isActive).toBe(false);
        });

        it('rejects a malformed limit and a malformed caseId with 400', async () => {
            expect((await request(app).get('/api/case-workflows?limit=abc').set(await authHeader('USER'))).status).toBe(400);
            expect((await request(app).get('/api/case-workflows?caseId=nope').set(await authHeader('USER'))).status).toBe(400);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 003 / 006 — reads
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-003 / 006 — reads', () => {

        it('003 returns the full shape and 404 for an id that does not exist', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);

            const res = await request(app).get(`/api/case-workflows/${ id }`).set(await authHeader('USER'));
            expect(res.status).toBe(200);
            expect(res.body.data.caseWorkflowId).toBe(id);
            expect(Object.keys(res.body.data.stages)).toEqual(stageKeys);
            expect(res.body.data.sysDetails).toBeUndefined();

            const missing = await request(app).get(`/api/case-workflows/${ missingUuid }`)
                .set(await authHeader('USER'));
            expect(missing.status).toBe(404);
            expect(missing.body.code).toBe('CASEFLOW_003_NOT_FOUND');
        });

        it('003 hides an inactive row from anyone who cannot view inactive records', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));

            // canViewInactive is SUPERADMIN only, across the whole repository
            expect((await request(app).get(`/api/case-workflows/${ id }`).set(await authHeader('USER'))).status).toBe(404);
            expect((await request(app).get(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'))).status).toBe(404);

            const asSuper = await request(app).get(`/api/case-workflows/${ id }`).set(await authHeader('SUPERADMIN'));
            expect(asSuper.status).toBe(200);
            expect(asSuper.body.data.isActive).toBe(false);
        });

        it('/admin resolves to the 002B listing and not to the 003', async () => {
            const res = await request(app).get('/api/case-workflows/admin').set(await authHeader('ADMIN'));
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveProperty('count');
            expect(res.body.data).toHaveProperty('rows');
        });

        it('006 tells the two 404s apart: unknown case and case with no workflow', async () => {
            const unknownCase = await getByCase(missingUuid);
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('CASEFLOW_006_CASE_NOT_FOUND');

            const legacyCase = await createLegacyCaseFixture();
            const noWorkflow = await getByCase(legacyCase);
            expect(noWorkflow.status).toBe(404);
            expect(noWorkflow.body.code).toBe('CASEFLOW_006_NOT_FOUND');
        });

        it('006 keeps exists and id of a stage that was deactivated with its 005A', async () => {
            const caseId = await createCaseFixture();
            const classification = await classify(caseId);
            const classificationId = classification.body.data.classificationId;

            await request(app).delete(`/api/classifications/${ classificationId }`).set(await authHeader('ADMIN'));

            const res = await getByCase(caseId);
            // The row is still there and a POST would hit the UNIQUE: what the client needs is to
            // reactivate it with its 005B, and for that it needs the id
            expect(res.body.data.stages.classification.exists).toBe(true);
            expect(res.body.data.stages.classification.id).toBe(classificationId);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 007 — complete stage
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-007 — complete stage', () => {

        it('rejects a stage outside the four values with 400', async () => {
            const caseId = await createCaseFixture();
            expect((await completeStage(caseId, 'FOO')).status).toBe(400);
            expect((await request(app)
                .patch(`/api/case-workflows/case/${ caseId }/complete-stage`)
                .set(await authHeader('USER')).send({})).status).toBe(400);
        });

        it('seals endedAt and leaves statusItemId untouched', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId);
            const before = await getByCase(caseId);

            const res = await completeStage(caseId, 'CLASSIFICATION');
            expect(res.status).toBe(200);
            expect(res.body.data.stages.classification.endedAt).not.toBeNull();
            expect(typeof res.body.data.stages.classification.durationMinutes).toBe('number');
            expect(res.body.data.status.catalogItemId).toBe(before.body.data.status.catalogItemId);
        });

        it('answers 409 for a stage not started, one already completed and a closed file', async () => {
            const notStarted = await createCaseFixture();
            const first = await completeStage(notStarted, 'CLASSIFICATION');
            expect(first.status).toBe(409);
            expect(first.body.code).toBe('CASEFLOW_007_STAGE_NOT_STARTED');

            const twice = await createCaseFixture();
            await classify(twice);
            await completeStage(twice, 'CLASSIFICATION');
            const again = await completeStage(twice, 'CLASSIFICATION');
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('CASEFLOW_007_STAGE_ALREADY_COMPLETED');

            const closedCase = await createClosableCase();
            await close(closedCase);
            const overClosed = await completeStage(closedCase, 'NOTIFICATION');
            expect(overClosed.status).toBe(409);
            expect(overClosed.body.code).toBe('CASEFLOW_007_CASE_CLOSED');
        });
    });

    // ---------------------------------------------------------------------------------------
    // 008 — close
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-008 — close', () => {

        it('demands the classification and the notification always', async () => {
            const bare = await createCaseFixture();
            const noClassification = await close(bare);
            expect(noClassification.status).toBe(409);
            expect(noClassification.body.code).toBe('CASEFLOW_008_CLASSIFICATION_REQUIRED');

            const onlyClassified = await createCaseFixture();
            await classify(onlyClassified);
            const noNotification = await close(onlyClassified);
            expect(noNotification.status).toBe(409);
            expect(noNotification.body.code).toBe('CASEFLOW_008_NOTIFICATION_REQUIRED');
        });

        // The four combinations of the table of §3.5
        it('serious=false, investigation=false closes with the two first stages', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId, false);
            await notify(caseId, false);
            expect((await close(caseId)).status).toBe(200);
        });

        it('serious=false, investigation=true demands investigation and final classification', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId, false);
            await notify(caseId, true);
            expect((await close(caseId)).body.code).toBe('CASEFLOW_008_INVESTIGATION_REQUIRED');
            await investigate(caseId);
            expect((await close(caseId)).body.code).toBe('CASEFLOW_008_FINAL_CLASSIFICATION_REQUIRED');
            await finalClassify(caseId);
            expect((await close(caseId)).status).toBe(200);
        });

        it('serious=true, investigation=false demands the final classification but not the investigation', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId, true);
            await notify(caseId, false);
            expect((await close(caseId)).body.code).toBe('CASEFLOW_008_FINAL_CLASSIFICATION_REQUIRED');
            await finalClassify(caseId);
            expect((await close(caseId)).status).toBe(200);
        });

        it('serious=true, investigation=true demands all four', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId, true);
            await notify(caseId, true);
            expect((await close(caseId)).body.code).toBe('CASEFLOW_008_INVESTIGATION_REQUIRED');
            await investigate(caseId);
            expect((await close(caseId)).body.code).toBe('CASEFLOW_008_FINAL_CLASSIFICATION_REQUIRED');
            await finalClassify(caseId);
            expect((await close(caseId)).status).toBe(200);
        });

        it('a deactivated stage does not count as done, unlike the exists of §3.7', async () => {
            const caseId = await createCaseFixture();
            const classification = await classify(caseId);
            await notify(caseId);
            await request(app)
                .delete(`/api/classifications/${ classification.body.data.classificationId }`)
                .set(await authHeader('ADMIN'));

            const res = await close(caseId);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('CASEFLOW_008_CLASSIFICATION_REQUIRED');
            // The stage still exists for the resume flow, but the precondition is not met
            expect((await getByCase(caseId)).body.data.stages.classification.exists).toBe(true);
        });

        it('answers 409 on a second close and on a close from PENDING_VALIDATION', async () => {
            const closedCase = await createClosableCase();
            await close(closedCase);
            const again = await close(closedCase);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('CASEFLOW_008_ALREADY_CLOSED');

            const pending = await createClosableCase();
            await requestValidation(pending);
            const res = await close(pending);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('CASEFLOW_008_PENDING_VALIDATION');
        });
    });

    // ---------------------------------------------------------------------------------------
    // 009 — reopen
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-009 — reopen', () => {

        it('needs ADMIN and refuses a case that is not closed', async () => {
            const openCase = await createCaseFixture();
            const notClosed = await reopen(openCase);
            expect(notClosed.status).toBe(409);
            expect(notClosed.body.code).toBe('CASEFLOW_009_NOT_CLOSED');

            const caseId = await createClosableCase();
            await close(caseId);
            expect((await reopen(caseId, 'USER')).status).toBe(403);
            expect((await reopen(caseId, 'ADMIN')).status).toBe(200);
        });

        it('after close-reopen-close-reopen, reopenCount is 2 and closedAt is the second close', async () => {
            const caseId = await createClosableCase();
            await close(caseId);
            await reopen(caseId);
            const secondClose = await close(caseId);
            const res = await reopen(caseId);

            expect(res.body.data.reopenCount).toBe(2);
            expect(res.body.data.closedAt).toBe(secondClose.body.data.closedAt);
        });

        it('REOPENED is transitory: the next stage takes the file out of it', async () => {
            const caseId = await createClosableCase();
            await close(caseId);
            await reopen(caseId);

            expect((await investigate(caseId)).status).toBe(201);
            const res = await getByCase(caseId);
            expect(res.body.data.status.code).toBe('IN_INVESTIGATION');
            expect(res.body.data.reopenCount).toBe(1);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 010 / 011 — validation
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-010 / 011 — validation', () => {

        it('requesting from IN_INVESTIGATION and resolving returns the file to IN_INVESTIGATION', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId);
            await notify(caseId);
            await investigate(caseId);

            const asked = await requestValidation(caseId);
            expect(asked.status).toBe(200);
            expect(asked.body.data.status.code).toBe('PENDING_VALIDATION');
            expect(asked.body.data.previousStatus.code).toBe('IN_INVESTIGATION');

            const resolved = await resolveValidation(caseId);
            expect(resolved.status).toBe(200);
            expect(resolved.body.data.status.code).toBe('IN_INVESTIGATION');
            expect(resolved.body.data.previousStatus).toBeNull();
        });

        it('advancing a stage while pending keeps the status and moves previousStatus', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId);
            await requestValidation(caseId);

            expect((await notify(caseId)).status).toBe(201);

            const during = await getByCase(caseId);
            expect(during.body.data.status.code).toBe('PENDING_VALIDATION');
            expect(during.body.data.previousStatus.code).toBe('IN_NOTIFICATION');
            expect(during.body.data.stages.notification.startedAt).not.toBeNull();

            const resolved = await resolveValidation(caseId);
            expect(resolved.body.data.status.code).toBe('IN_NOTIFICATION');
            expect(resolved.body.data.previousStatus).toBeNull();
        });

        it('answers 409 on a second request, on resolving what is not pending and over a closed file', async () => {
            const twice = await createCaseFixture();
            await requestValidation(twice);
            const again = await requestValidation(twice);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('CASEFLOW_010_ALREADY_PENDING');

            const notPending = await createCaseFixture();
            const res = await resolveValidation(notPending);
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('CASEFLOW_011_NOT_PENDING');

            const closedCase = await createClosableCase();
            await close(closedCase);
            const overClosed = await requestValidation(closedCase);
            expect(overClosed.status).toBe(409);
            expect(overClosed.body.code).toBe('CASEFLOW_010_CASE_CLOSED');
        });
    });

    // ---------------------------------------------------------------------------------------
    // 005A / 005B — activation of the RECORD
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-005A / 005B — activation', () => {

        it('both answer { ok, message } with no data and 409 on the second call', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);

            const removed = await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));
            expect(removed.status).toBe(200);
            expect('data' in removed.body).toBe(false);

            const removedAgain = await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));
            expect(removedAgain.status).toBe(409);
            expect(removedAgain.body.code).toBe('CASEFLOW_005A_ALREADY_INACTIVE');

            const activated = await request(app).patch(`/api/case-workflows/activate/${ id }`)
                .set(await authHeader('SUPERADMIN'));
            expect(activated.status).toBe(200);
            expect('data' in activated.body).toBe(false);

            const activatedAgain = await request(app).patch(`/api/case-workflows/activate/${ id }`)
                .set(await authHeader('SUPERADMIN'));
            expect(activatedAgain.status).toBe(409);
            expect(activatedAgain.body.code).toBe('CASEFLOW_005B_ALREADY_ACTIVE');
        });

        it('deactivating the record does NOT close the case file', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));

            const res = await request(app).get(`/api/case-workflows/${ id }`).set(await authHeader('SUPERADMIN'));
            expect(res.body.data.isActive).toBe(false);
            expect(res.body.data.status.code).toBe('OPEN');
            expect(res.body.data.closedAt).toBeNull();
        });

        it('stores the operation code in appDetails with no suffixes', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            await request(app).delete(`/api/case-workflows/${ id }`).set(await authHeader('ADMIN'));
            await request(app).patch(`/api/case-workflows/activate/${ id }`).set(await authHeader('SUPERADMIN'));

            const workflow = await CaseWorkflow.findOne({ where: { caseId } });
            const methods = ( workflow!.getDataValue('appDetails') as { method: string }[] ).map(entry => entry.method);
            expect(methods).toContain('ESAVI-CASEFLOW-005A');
            expect(methods).toContain('ESAVI-CASEFLOW-005B');
        });
    });

    // ---------------------------------------------------------------------------------------
    // 012 — propagation, and the absences of the contract
    // ---------------------------------------------------------------------------------------

    describe('ESAVI-CASEFLOW-012 — propagation', () => {

        it('refuses a stage over a closed file and creates no row', async () => {
            const caseId = await createClosableCase();
            await close(caseId);

            const investigation = await investigate(caseId);
            expect(investigation.status).toBe(409);
            expect(investigation.body.code).toBe('CASEFLOW_012_CASE_CLOSED');

            // The rollback is what guarantees this
            expect((await getByCase(caseId)).body.data.stages.investigation.exists).toBe(false);
        });

        it('a stage over a case from before this spec answers 404 and creates no row', async () => {
            const legacyCase = await createLegacyCaseFixture();
            const classification = await classify(legacyCase);
            expect(classification.status).toBe(404);
            expect(classification.body.code).toBe('CASEFLOW_012_NOT_FOUND');
        });
    });

    describe('the absences of the contract', () => {

        it('there is no 004: PUT /:id answers the 404 of Express', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            const res = await request(app).put(`/api/case-workflows/${ id }`)
                .set(await authHeader('USER')).send({ statusItemId: await statusIdOf('CLOSED') });
            expect(res.status).toBe(404);
        });

        it('there is no 005C: DELETE /purge/:id answers the 404 of Express', async () => {
            const caseId = await createCaseFixture();
            const id = await workflowIdOf(caseId);
            const res = await request(app).delete(`/api/case-workflows/purge/${ id }`)
                .set(await authHeader('SUPERADMIN'));
            expect(res.status).toBe(404);
        });

        it('there is no 001: the row is born inside ESAVI-CASE-001, and POST / does not exist', async () => {
            const legacyCase = await createLegacyCaseFixture();
            const res = await request(app).post('/api/case-workflows')
                .set(await authHeader('USER')).send({ caseId: legacyCase });
            expect(res.status).toBe(404);
        });

        it('no transition accepts a stamp, a status or a reopenCount from the client', async () => {
            const caseId = await createCaseFixture();
            await classify(caseId);

            // The only field that travels in a body of this entity is `stage` in 007
            const res = await request(app)
                .patch(`/api/case-workflows/case/${ caseId }/complete-stage`)
                .set(await authHeader('USER'))
                .send({
                    stage: 'CLASSIFICATION',
                    closedAt: '2020-01-01T00:00:00.000Z',
                    reopenCount: 99,
                    statusItemId: await statusIdOf('CLOSED')
                });

            expect(res.status).toBe(200);
            expect(res.body.data.closedAt).toBeNull();
            expect(res.body.data.reopenCount).toBe(0);
            expect(res.body.data.status.code).toBe('IN_CLASSIFICATION');
        });
    });
});
