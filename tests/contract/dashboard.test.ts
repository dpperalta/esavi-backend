import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import {
    AppUserGeoLocation,
    CaseWorkflow,
    CatalogItem,
    CatalogType,
    Classification,
    EsaviCase,
    FinalClassification,
    GeoLevelType,
    GeoLocation,
    HealthFacility,
    Investigation,
    InvestigationAdministrationError,
    InvestigationAutopsy,
    InvestigationColdChain,
    Notification,
    NotificationVaccine,
    Patient,
    SystemConfig,
    VaccineWhodrug
} from '../../src/models';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../src/database/connection';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { advanceCaseWorkflowStageService } from '../../src/services/caseWorkflow.service';
import { CASE_WORKFLOW_STATUS } from '../../src/constants/caseWorkflow.constants';
import { closeTestDatabase, seedCaseWorkflow, setCaseWorkflowStatus } from '../setup/database';
import { TEST_ROLES, seedTestUsers, seedUserWithoutRole, authHeader, authHeaderWithoutRole, createScopedTestUser } from '../setup/auth';
import type { TestRole } from '../setup/auth';

const VARIANT_SPELLINGS = ['var1', 'VAR1', 'Var-1', 'VAR 1', 'V.A.R.1', 'va r1'];

interface FunnelEntry { statusCode: string; statusName: string; sortOrder: number; count: number }
interface StalledItem { caseId: string; caseCode: string; statusCode: string; openStage: string | null; referenceAt: string; daysStalled: number }
interface PendingItem { caseId: string; caseCode: string; statusCode: string; requestedAt: string; daysWaiting: number }

describe('dashboard contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const tag = `DASH${ suffix }`;
    const base = '/api/dashboard/pending-work';
    const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');
    const dayMs = 24 * 60 * 60 * 1000;
    const daysAgo = ( days: number ): Date => new Date(Date.now() - days * dayMs);

    let consoleError: jest.SpyInstance;
    let levelTypeId: string;
    let provinceAId: string;
    let cantonAId: string;
    let provinceBId: string;
    let provinceCId: string;
    let userAToken: string;
    let userCToken: string;
    let noScopeToken: string;

    const ids: Record<string, string> = {};

    const bearer = ( token: string ): Record<string, string> => ({ Authorization: `Bearer ${ token }` });
    const fetchAs = ( headers: Record<string, string> ) => request(app).get(base).set(headers);
    const fetchA = async () => ( await fetchAs(bearer(userAToken)) ).body.data;
    const funnelCount = ( data: { funnel: FunnelEntry[] }, code: string ): number =>
        data.funnel.find(( entry ) => entry.statusCode === code )!.count;
    const funnelTotal = ( data: { funnel: FunnelEntry[] } ): number =>
        data.funnel.reduce(( sum, entry ) => sum + entry.count, 0 );
    const stalledOf = ( data: { stalled: { items: StalledItem[] } }, caseId: string ): StalledItem | undefined =>
        data.stalled.items.find(( item ) => item.caseId === caseId );
    const pendingOf = ( data: { pendingInvestigations: { items: PendingItem[] } }, caseId: string ): PendingItem | undefined =>
        data.pendingInvestigations.items.find(( item ) => item.caseId === caseId );

    const staleDaysRow = async () => SystemConfig.findOne({ where: { code: 'ESAVI_DASHBOARD_STALE_DAYS', scope: 'DASHBOARD' } });

    const withStaleDays = async <T>( value: number, run: () => Promise<T> ): Promise<T> => {
        const row = await staleDaysRow();
        const original = row!.getDataValue('value');
        await row!.update({ value });
        try {
            return await run();
        } finally {
            await row!.update({ value: original });
        }
    };

    const createGeoLocation = async ( label: string, parent: string | null, level: number ): Promise<string> => {
        const geo = await GeoLocation.create({
            geoLevelTypeId: levelTypeId,
            parentGeoLocationId: parent,
            code: `${ label }_${ suffix }`,
            name: `${ label } ${ suffix }`,
            level
        });
        return geo.getDataValue('geoLocationId');
    };

    const seedCase = async (
        label: string,
        geoLocationId: string | null,
        statusCode: string,
        stamps: Record<string, unknown> = {},
        notification?: { requestInvestigation: boolean }
    ): Promise<string> => {
        const facility = await HealthFacility.create({
            localCode: `${ tag }${ label }`, name: `${ tag } ${ label }`, geoLocationId
        });
        const patient = await Patient.create({
            names: esaviCrypt(`Dash ${ label }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`DS${ label }${ suffix }`),
            healthSystemCode: `DS${ label }${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            caseCode: `${ tag }-${ label }`,
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            reportDate: '2026-05-01',
            isActive: true
        });
        const caseId = esaviCase.getDataValue('caseId');
        await seedCaseWorkflow(caseId);
        if( statusCode !== CASE_WORKFLOW_STATUS.OPEN ) await setCaseWorkflowStatus(caseId, statusCode);
        if( Object.keys(stamps).length > 0 ) await CaseWorkflow.update(stamps, { where: { caseId } });
        if( notification ) {
            await Notification.create({
                caseId,
                notificationType: 'SEVERE',
                esaviDescription: `Dash ${ label }`,
                requestInvestigation: notification.requestInvestigation
            });
        }
        ids[label] = caseId;
        return caseId;
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        await request(app).post('/api/system-configs/sync').set(authHeader('SUPERADMIN'));

        const baseLevel = ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) || 0;
        const levelType = await GeoLevelType.create({
            code: `LVLDASH_${ suffix }`, name: `LevelDash ${ suffix }`, sortOrder: 1
        });
        levelTypeId = levelType.getDataValue('geoLevelTypeId');

        provinceAId = await createGeoLocation('PROVADASH', null, baseLevel + 1);
        cantonAId = await createGeoLocation('CANTADASH', provinceAId, baseLevel + 2);
        provinceBId = await createGeoLocation('PROVBDASH', null, baseLevel + 1);
        provinceCId = await createGeoLocation('PROVCDASH', null, baseLevel + 1);

        await seedCase('STALL', cantonAId, CASE_WORKFLOW_STATUS.IN_INVESTIGATION, {
            openedAt: daysAgo(30),
            classificationStartedAt: daysAgo(30), classificationEndedAt: daysAgo(28),
            notificationStartedAt: daysAgo(28), notificationEndedAt: daysAgo(25),
            investigationStartedAt: daysAgo(20)
        });
        await seedCase('REOPEN', cantonAId, CASE_WORKFLOW_STATUS.REOPENED, {
            openedAt: daysAgo(60),
            investigationStartedAt: daysAgo(40),
            lastReopenedAt: daysAgo(1),
            reopenCount: 1
        });
        await seedCase('CLOSEDOLD', cantonAId, CASE_WORKFLOW_STATUS.CLOSED, {
            openedAt: daysAgo(200),
            investigationStartedAt: daysAgo(180),
            reopenCount: 2
        });
        await seedCase('PENDING', provinceAId, CASE_WORKFLOW_STATUS.IN_NOTIFICATION, {
            openedAt: daysAgo(8),
            notificationStartedAt: daysAgo(8), notificationEndedAt: daysAgo(5)
        }, { requestInvestigation: true });
        await seedCase('NOTENDED', cantonAId, CASE_WORKFLOW_STATUS.IN_NOTIFICATION, {
            openedAt: daysAgo(3), notificationStartedAt: daysAgo(3)
        }, { requestInvestigation: true });
        await seedCase('NOREQUEST', cantonAId, CASE_WORKFLOW_STATUS.IN_NOTIFICATION, {
            openedAt: daysAgo(6),
            notificationStartedAt: daysAgo(6), notificationEndedAt: daysAgo(4)
        }, { requestInvestigation: false });
        await seedCase('FRESH', cantonAId, CASE_WORKFLOW_STATUS.OPEN);

        await seedCase('BSIDE', provinceBId, CASE_WORKFLOW_STATUS.IN_INVESTIGATION, {
            openedAt: daysAgo(50),
            notificationStartedAt: daysAgo(50), notificationEndedAt: daysAgo(45),
            lastReopenedAt: daysAgo(30), reopenCount: 1
        }, { requestInvestigation: true });

        for( let index = 0; index < 12; index++ ) {
            await seedCase(`TOP${ `${ index }`.padStart(2, '0') }`, provinceCId, CASE_WORKFLOW_STATUS.IN_CLASSIFICATION, {
                openedAt: daysAgo(16 + index), classificationStartedAt: daysAgo(16 + index)
            });
        }

        userAToken = ( await createScopedTestUser('dashboard-a', provinceAId) ).token;
        userCToken = ( await createScopedTestUser('dashboard-c', provinceCId) ).token;
        noScopeToken = ( await createScopedTestUser('dashboard-empty', null) ).token;
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('surface', () => {

        it.each(['USER', 'NOTIFIER', 'INVESTIGATOR', 'EVALUATOR', 'ADMIN', 'SUPERADMIN'] as TestRole[])('answers 200 to %s', async ( role ) => {
            const response = await fetchAs(authHeader(role));
            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            expect(typeof response.body.message).toBe('string');
        });

        it('answers 403 to ANALYTICS and 401 without a token', async () => {
            expect(( await fetchAs(authHeader('ANALYTICS')) ).status).toBe(403);
            expect(( await request(app).get(base) ).status).toBe(401);
        });

        it('returns exactly the keys of the contract', async () => {
            const data = await fetchA();
            expect(Object.keys(data).sort()).toEqual(
                ['funnel', 'generatedAt', 'openCases', 'pendingInvestigations', 'reopened', 'scope', 'stalled'].sort()
            );
            expect(Object.keys(data.scope).sort()).toEqual(['hasAssignments', 'restricted']);
            expect(Object.keys(data.stalled).sort()).toEqual(['items', 'staleDays', 'total']);
            expect(Object.keys(data.pendingInvestigations).sort()).toEqual(['items', 'total']);
            expect(Object.keys(data.reopened)).toEqual(['total']);
        });
    });

    describe('funnel', () => {

        it('always brings the eight states in sortOrder, including the empty ones', async () => {
            const data = await fetchA();
            expect(data.funnel).toHaveLength(8);
            expect(data.funnel.map(( entry: FunnelEntry ) => entry.statusCode ).sort()).toEqual(Object.values(CASE_WORKFLOW_STATUS).sort());
            const orders = data.funnel.map(( entry: FunnelEntry ) => entry.sortOrder );
            expect(orders).toEqual([...orders].sort(( a, b ) => a - b ));
            expect(funnelCount(data, CASE_WORKFLOW_STATUS.IN_FINAL_CLASSIFICATION)).toBe(0);
        });

        it('sums the cases of the scope, and openCases is that sum minus CLOSED', async () => {
            const data = await fetchA();
            expect(funnelTotal(data)).toBe(7);
            expect(funnelCount(data, CASE_WORKFLOW_STATUS.CLOSED)).toBe(1);
            expect(data.openCases).toBe(6);
            expect(funnelCount(data, CASE_WORKFLOW_STATUS.IN_NOTIFICATION)).toBe(3);
        });

        it('stops counting a deactivated case', async () => {
            const caseId = await seedCase('DEACT', cantonAId, CASE_WORKFLOW_STATUS.OPEN);
            const before = await fetchA();
            expect(( await request(app).delete(`/api/esavi-cases/${ caseId }`).set(authHeader('ADMIN')) ).status).toBe(200);
            const after = await fetchA();
            expect(funnelTotal(after)).toBe(funnelTotal(before) - 1);
            expect(funnelCount(after, CASE_WORKFLOW_STATUS.OPEN)).toBe(funnelCount(before, CASE_WORKFLOW_STATUS.OPEN) - 1);
        });
    });

    describe('scope — SPEC F49', () => {

        it('an ADMIN sees both territories and is not restricted', async () => {
            const response = await fetchAs(authHeader('ADMIN'));
            expect(response.body.data.scope).toEqual({ restricted: false, hasAssignments: true });
            const total = funnelTotal(response.body.data);
            expect(total).toBeGreaterThanOrEqual(funnelTotal(await fetchA()) + 1);
        });

        it('a USER of territory A counts nothing of territory B in any block', async () => {
            const data = await fetchA();
            expect(data.scope).toEqual({ restricted: true, hasAssignments: true });
            const listed = [...data.stalled.items, ...data.pendingInvestigations.items].map(( item: { caseId: string } ) => item.caseId );
            expect(listed).not.toContain(ids.BSIDE);
            expect(funnelCount(data, CASE_WORKFLOW_STATUS.IN_INVESTIGATION)).toBe(1);
            expect(data.pendingInvestigations.total).toBe(1);
            expect(data.reopened.total).toBe(1);
        });

        it('a USER with no assignments gets 200, zeros everywhere, the eight states and hasAssignments false', async () => {
            const response = await fetchAs(bearer(noScopeToken));
            expect(response.status).toBe(200);
            const data = response.body.data;
            expect(data.scope).toEqual({ restricted: true, hasAssignments: false });
            expect(data.funnel).toHaveLength(8);
            expect(funnelTotal(data)).toBe(0);
            expect(data.openCases).toBe(0);
            expect(data.stalled.total).toBe(0);
            expect(data.stalled.items).toEqual([]);
            expect(data.pendingInvestigations).toEqual({ total: 0, items: [] });
            expect(data.reopened).toEqual({ total: 0 });
        });

        it('a case in a facility without geoLocationId is counted by an ADMIN and not by a USER', async () => {
            const adminBefore = funnelTotal(( await fetchAs(authHeader('ADMIN')) ).body.data);
            const userBefore = funnelTotal(await fetchA());
            await seedCase('NOGEO', null, CASE_WORKFLOW_STATUS.OPEN);
            expect(funnelTotal(( await fetchAs(authHeader('ADMIN')) ).body.data)).toBe(adminBefore + 1);
            expect(funnelTotal(await fetchA())).toBe(userBefore);
        });
    });

    describe('stalled', () => {

        it('a case with its investigation open for 20 days appears with threshold 15', async () => {
            const data = await fetchA();
            expect(data.stalled.staleDays).toBe(15);
            const item = stalledOf(data, ids.STALL);
            expect(item).toBeDefined();
            expect(item!.openStage).toBe('INVESTIGATION');
            expect(item!.daysStalled).toBe(20);
            expect(item!.statusCode).toBe(CASE_WORKFLOW_STATUS.IN_INVESTIGATION);
        });

        it('the same case does not appear with threshold 30', async () => {
            const data = await withStaleDays(30, fetchA);
            expect(data.stalled.staleDays).toBe(30);
            expect(stalledOf(data, ids.STALL)).toBeUndefined();
        });

        it('a reopening restarts the clock: reopened yesterday over a stage opened 40 days ago is 1 day', async () => {
            const data = await withStaleDays(1, fetchA);
            const item = stalledOf(data, ids.REOPEN);
            expect(item).toBeDefined();
            expect(item!.daysStalled).toBe(1);
            expect(item!.openStage).toBe('INVESTIGATION');
        });

        it('a CLOSED case never appears, however old', async () => {
            const data = await withStaleDays(1, fetchA);
            expect(stalledOf(data, ids.CLOSEDOLD)).toBeUndefined();
        });

        it('caps items at 10 in ascending referenceAt and counts every stalled case in total', async () => {
            const data = ( await fetchAs(bearer(userCToken)) ).body.data;
            expect(data.stalled.total).toBe(12);
            expect(data.stalled.items).toHaveLength(10);
            const stamps = data.stalled.items.map(( item: StalledItem ) => item.referenceAt );
            expect(stamps).toEqual([...stamps].sort());
            expect(data.stalled.items[0].caseId).toBe(ids.TOP11);
            expect(data.stalled.items.map(( item: StalledItem ) => item.caseId )).not.toContain(ids.TOP00);
        });

        it('threshold 0 disables the block', async () => {
            const data = await withStaleDays(0, fetchA);
            expect(data.stalled).toEqual({ staleDays: 0, total: 0, items: [] });
        });

        it('a deactivated configuration without environment variable answers 200 with staleDays 0 and logs the warning', async () => {
            const row = await staleDaysRow();
            const envValue = process.env.ESAVI_DASHBOARD_STALE_DAYS;
            delete process.env.ESAVI_DASHBOARD_STALE_DAYS;
            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;
            await row!.update({ isActive: false });
            try {
                const response = await fetchAs(bearer(userAToken));
                expect(response.status).toBe(200);
                expect(response.body.data.stalled).toEqual({ staleDays: 0, total: 0, items: [] });
                await new Promise(( resolve ) => setTimeout(resolve, 200));
                const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
                expect(added).toContain('ESAVI-DASH-006 - ESAVI_DASHBOARD_STALE_DAYS missing or invalid, stalled block disabled');
            } finally {
                await row!.update({ isActive: true });
                if( envValue !== undefined ) process.env.ESAVI_DASHBOARD_STALE_DAYS = envValue;
            }
        });

        it('requesting validation (ESAVI-CASEFLOW-010) does not move referenceAt nor daysStalled', async () => {
            const caseId = await seedCase('VALID', cantonAId, CASE_WORKFLOW_STATUS.IN_INVESTIGATION, {
                openedAt: daysAgo(25), investigationStartedAt: daysAgo(22)
            });
            const before = stalledOf(await fetchA(), caseId);
            expect(before).toBeDefined();

            const transition = await request(app).patch(`/api/case-workflows/case/${ caseId }/request-validation`).set(authHeader('ADMIN'));
            expect(transition.status).toBe(200);

            const after = stalledOf(await fetchA(), caseId);
            expect(after).toBeDefined();
            expect(after!.statusCode).toBe(CASE_WORKFLOW_STATUS.PENDING_VALIDATION);
            expect(after!.referenceAt).toBe(before!.referenceAt);
            expect(after!.daysStalled).toBe(before!.daysStalled);
        });
    });

    describe('pending investigations', () => {

        it('a requested investigation with the notification closed and not started appears, dated at notificationEndedAt', async () => {
            const data = await fetchA();
            const item = pendingOf(data, ids.PENDING);
            expect(item).toBeDefined();
            const workflow = await CaseWorkflow.findOne({ where: { caseId: ids.PENDING } });
            expect(item!.requestedAt).toBe(new Date(workflow!.getDataValue('notificationEndedAt')).toISOString());
            expect(item!.daysWaiting).toBe(5);
        });

        it('a request with the notification still open does not appear', async () => {
            expect(pendingOf(await fetchA(), ids.NOTENDED)).toBeUndefined();
        });

        it('a notification without requestInvestigation does not appear', async () => {
            expect(pendingOf(await fetchA(), ids.NOREQUEST)).toBeUndefined();
        });

        it('leaves the block as soon as ESAVI-CASEFLOW-012 stamps investigationStartedAt', async () => {
            const caseId = await seedCase('STARTS', cantonAId, CASE_WORKFLOW_STATUS.IN_NOTIFICATION, {
                openedAt: daysAgo(4), notificationStartedAt: daysAgo(4), notificationEndedAt: daysAgo(2)
            }, { requestInvestigation: true });
            expect(pendingOf(await fetchA(), caseId)).toBeDefined();

            await advanceCaseWorkflowStageService(caseId, 'INVESTIGATION', undefined, 'en');

            expect(pendingOf(await fetchA(), caseId)).toBeUndefined();
        });
    });

    describe('reopened', () => {

        it('a reopened case adds 1 until it is closed again', async () => {
            const caseId = await seedCase('REOPEN2', cantonAId, CASE_WORKFLOW_STATUS.CLOSED, { openedAt: daysAgo(10) });
            const before = ( await fetchA() ).reopened.total;

            const reopen = await request(app).patch(`/api/case-workflows/case/${ caseId }/reopen`).set(authHeader('ADMIN'));
            expect(reopen.status).toBe(200);
            expect(( await fetchA() ).reopened.total).toBe(before + 1);

            await setCaseWorkflowStatus(caseId, CASE_WORKFLOW_STATUS.CLOSED);
            expect(( await fetchA() ).reopened.total).toBe(before);
        });
    });

    describe('statusCode filter of the case listing', () => {

        it('the count of ?statusCode matches the funnel for the same user', async () => {
            const data = await fetchA();
            for( const code of [CASE_WORKFLOW_STATUS.IN_INVESTIGATION, CASE_WORKFLOW_STATUS.IN_NOTIFICATION, CASE_WORKFLOW_STATUS.CLOSED] ) {
                const listing = await request(app).get(`/api/esavi-cases?statusCode=${ code }`).set(bearer(userAToken));
                expect(listing.status).toBe(200);
                expect(listing.body.data.count).toBe(funnelCount(data, code));
            }
        });
    });

    describe('exposed data', () => {

        it('items carry exactly the declared keys and no patient data', async () => {
            const data = await withStaleDays(1, fetchA);
            expect(data.stalled.items.length).toBeGreaterThan(0);
            for( const item of data.stalled.items ) {
                expect(Object.keys(item).sort()).toEqual(['caseCode', 'caseId', 'daysStalled', 'openStage', 'referenceAt', 'statusCode']);
            }
            expect(data.pendingInvestigations.items.length).toBeGreaterThan(0);
            for( const item of data.pendingInvestigations.items ) {
                expect(Object.keys(item).sort()).toEqual(['caseCode', 'caseId', 'daysWaiting', 'requestedAt', 'statusCode']);
            }
        });
    });

    describe('no writes', () => {

        it('calling ESAVI-DASH-006 leaves updatedAt, appDetails and sysDetails of cases and workflows untouched', async () => {
            const caseIds = [ids.STALL, ids.PENDING, ids.REOPEN, ids.CLOSEDOLD];
            const snapshot = async () => {
                const cases = await EsaviCase.findAll({ where: { caseId: caseIds }, attributes: ['caseId', 'updatedAt', 'appDetails', 'sysDetails'], order: [['caseId', 'ASC']] });
                const workflows = await CaseWorkflow.findAll({ where: { caseId: caseIds }, attributes: ['caseId', 'updatedAt', 'appDetails', 'sysDetails'], order: [['caseId', 'ASC']] });
                return JSON.stringify([cases.map(( row ) => row.toJSON() ), workflows.map(( row ) => row.toJSON() )]);
            };
            const before = await snapshot();
            expect(( await fetchAs(bearer(userAToken)) ).status).toBe(200);
            expect(( await fetchAs(authHeader('ADMIN')) ).status).toBe(200);
            expect(await snapshot()).toBe(before);
        });
    });

    describe('indicators — ESAVI-DASH-007', () => {

        const indicators = '/api/dashboard/indicators';
        const period = 'from=2026-03-01&to=2026-03-31';
        const indicatorIds: Record<string, string> = {};

        let provinceIndId: string;
        let cantonIndId: string;
        let provinceOtherId: string;
        let medianThreeId: string;
        let medianTwoId: string;
        let analystToken: string;
        let analystEmptyToken: string;
        let userIndToken: string;
        let topImportanceItemId: string;

        interface IndicatorCaseOptions {
            geoLocationId: string;
            reportDate: string;
            eventDate?: string;
            notification?: { notificationType: 'SEVERE' | 'NON_SEVERE'; deathDate?: string; autopsyRequested?: boolean };
            classification?: Record<string, boolean>;
            autopsy?: { isDeath: boolean; isAutopsyPerformed: boolean; deleted?: boolean };
            finalClassification?: Record<string, unknown>;
            statusCode?: string;
            stamps?: Record<string, unknown>;
        }

        const seedIndicatorCase = async ( label: string, options: IndicatorCaseOptions ): Promise<string> => {
            const facility = await HealthFacility.create({
                localCode: `${ tag }I${ label }`, name: `${ tag } I${ label }`, geoLocationId: options.geoLocationId
            });
            const patient = await Patient.create({
                names: esaviCrypt(`Ind ${ label }`),
                lastNames: esaviCrypt(`Probe ${ suffix }`),
                documentNumber: esaviCrypt(`DI${ label }${ suffix }`),
                healthSystemCode: `DI${ label }${ suffix }`
            });
            const esaviCase = await EsaviCase.create({
                caseCode: `${ tag }-I${ label }`,
                patientId: patient.getDataValue('patientId'),
                healthFacilityId: facility.getDataValue('healthFacilityId'),
                reportDate: options.reportDate,
                eventDate: options.eventDate ?? null,
                isActive: true
            });
            const caseId = esaviCase.getDataValue('caseId');
            await seedCaseWorkflow(caseId);
            if( options.statusCode ) await setCaseWorkflowStatus(caseId, options.statusCode);
            if( options.stamps ) await CaseWorkflow.update(options.stamps, { where: { caseId } });
            if( options.notification ) {
                await Notification.create({
                    caseId,
                    notificationType: options.notification.notificationType,
                    esaviDescription: `Ind ${ label }`,
                    deathDate: options.notification.deathDate ?? null,
                    autopsyRequested: options.notification.autopsyRequested ?? null
                });
            }
            if( options.classification ) {
                await Classification.create({ caseId, ...options.classification });
            }
            if( options.autopsy ) {
                const investigation = await Investigation.create({ caseId });
                await InvestigationAutopsy.create({
                    investigationId: investigation.getDataValue('investigationId'),
                    isDeath: options.autopsy.isDeath,
                    isAutopsyPerformed: options.autopsy.isAutopsyPerformed,
                    deletedAt: options.autopsy.deleted ? new Date() : null
                });
            }
            if( options.finalClassification ) {
                await FinalClassification.create({ caseId, ...options.finalClassification });
            }
            indicatorIds[label] = caseId;
            return caseId;
        };

        const getIndicators = ( headers: Record<string, string>, query = '' ) =>
            request(app).get(`${ indicators }${ query ? `?${ query }` : '' }`).set(headers);
        const analystData = async ( query = period ) => ( await getIndicators(bearer(analystToken), query) ).body.data;

        const localToday = (): string => {
            const now = new Date();
            return `${ now.getFullYear() }-${ `${ now.getMonth() + 1 }`.padStart(2, '0') }-${ `${ now.getDate() }`.padStart(2, '0') }`;
        };
        const shiftDays = ( isoDate: string, days: number ): string => {
            const [year, month, day] = isoDate.split('-').map(Number);
            return new Date(Date.UTC(year, month - 1, day) + days * dayMs).toISOString().slice(0, 10);
        };

        const collectKeys = ( value: unknown, keys: Set<string> = new Set() ): Set<string> => {
            if( Array.isArray(value) ) value.forEach(( item ) => collectKeys(item, keys) );
            else if( value && typeof value === 'object' ) {
                for( const [key, nested] of Object.entries(value) ) {
                    keys.add(key);
                    collectKeys(nested, keys);
                }
            }
            return keys;
        };

        beforeAll(async () => {
            await seedUserWithoutRole();

            const baseLevel = ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) || 0;
            provinceIndId = await createGeoLocation('PROVIND', null, baseLevel + 1);
            cantonIndId = await createGeoLocation('CANTIND', provinceIndId, baseLevel + 2);
            provinceOtherId = await createGeoLocation('PROVOTHIND', null, baseLevel + 1);
            medianThreeId = await createGeoLocation('PROVMED3', null, baseLevel + 1);
            medianTwoId = await createGeoLocation('PROVMED2', null, baseLevel + 1);

            const importanceItem = await CatalogItem.findOne({
                where: { value: 'MAX', isActive: true },
                include: [{ model: CatalogType, as: 'catalogType', where: { code: 'finalClassificationImportance' }, attributes: [] }]
            });
            topImportanceItemId = importanceItem!.getDataValue('catalogItemId');

            await seedIndicatorCase('E1', {
                geoLocationId: cantonIndId, reportDate: '2026-03-01', eventDate: '2026-02-27',
                notification: { notificationType: 'SEVERE', deathDate: '2026-02-28', autopsyRequested: false },
                classification: { isSeriousEvent: true, causedDeath: true, causedHospitalization: true },
                autopsy: { isDeath: true, isAutopsyPerformed: true },
                finalClassification: { dIsUnclassifiable: true, aIsRelatedToStress: true }
            });
            await seedIndicatorCase('E2', {
                geoLocationId: cantonIndId, reportDate: '2026-03-31', eventDate: '2026-03-27',
                notification: { notificationType: 'NON_SEVERE' },
                classification: { isSeriousEvent: false },
                finalClassification: { importanceBItemId: topImportanceItemId, aIsRelatedToStress: true }
            });
            await seedIndicatorCase('E3', {
                geoLocationId: cantonIndId, reportDate: '2026-03-15', eventDate: '2026-03-05',
                classification: { isSeriousEvent: true, causedDeath: true },
                finalClassification: { bHasDeterminantFactor: true, cHasCoincidentCause: true }
            });
            await seedIndicatorCase('E4', {
                geoLocationId: cantonIndId, reportDate: '2026-03-15', eventDate: '2026-02-13',
                notification: { notificationType: 'SEVERE', deathDate: '2026-02-20' },
                finalClassification: {}
            });
            await seedIndicatorCase('E5', {
                geoLocationId: cantonIndId, reportDate: '2026-03-15', eventDate: '2026-02-12',
                notification: { notificationType: 'SEVERE', autopsyRequested: true },
                autopsy: { isDeath: true, isAutopsyPerformed: false },
                finalClassification: { aIsRelatedToVaccineProduct: true, aIsRelatedToStress: true }
            });
            await seedIndicatorCase('E6', {
                geoLocationId: provinceIndId, reportDate: '2026-03-15',
                autopsy: { isDeath: true, isAutopsyPerformed: true, deleted: true }
            });
            await seedIndicatorCase('P1', {
                geoLocationId: cantonIndId, reportDate: '2026-02-28', eventDate: '2026-02-20',
                notification: { notificationType: 'SEVERE' },
                classification: { isSeriousEvent: true, causedDeath: true }
            });
            await seedIndicatorCase('OUT', { geoLocationId: cantonIndId, reportDate: '2026-01-28' });

            await seedIndicatorCase('CLOSE10', {
                geoLocationId: cantonIndId, reportDate: '2025-12-01', statusCode: CASE_WORKFLOW_STATUS.CLOSED,
                stamps: {
                    openedAt: new Date('2026-03-01T12:00:00Z'), closedAt: new Date('2026-03-11T12:00:00Z'),
                    classificationStartedAt: new Date('2026-03-01T12:00:00Z'), classificationEndedAt: new Date('2026-03-03T12:00:00Z')
                }
            });
            await seedIndicatorCase('CLOSE20', {
                geoLocationId: cantonIndId, reportDate: '2025-12-01', statusCode: CASE_WORKFLOW_STATUS.CLOSED,
                stamps: {
                    openedAt: new Date('2026-03-01T12:00:00Z'), closedAt: new Date('2026-03-21T12:00:00Z'),
                    classificationStartedAt: new Date('2026-03-01T12:00:00Z'), classificationEndedAt: new Date('2026-03-05T12:00:00Z'),
                    notificationStartedAt: new Date('2026-03-05T12:00:00Z')
                }
            });
            await seedIndicatorCase('REOPENIND', {
                geoLocationId: cantonIndId, reportDate: '2025-12-01', statusCode: CASE_WORKFLOW_STATUS.REOPENED,
                stamps: { openedAt: new Date('2026-03-01T12:00:00Z'), closedAt: new Date('2026-03-15T12:00:00Z') }
            });

            await seedIndicatorCase('OTHER', {
                geoLocationId: provinceOtherId, reportDate: '2026-03-15', eventDate: '2026-03-14',
                notification: { notificationType: 'SEVERE', deathDate: '2026-03-14' },
                classification: { isSeriousEvent: true, causedDeath: true },
                finalClassification: { dIsUnclassifiable: true }
            });

            await seedIndicatorCase('M3A', { geoLocationId: medianThreeId, reportDate: '2026-03-10', eventDate: '2026-03-08' });
            await seedIndicatorCase('M3B', { geoLocationId: medianThreeId, reportDate: '2026-03-10', eventDate: '2026-03-06' });
            await seedIndicatorCase('M3C', { geoLocationId: medianThreeId, reportDate: '2026-03-10', eventDate: '2026-02-28' });
            await seedIndicatorCase('M2A', { geoLocationId: medianTwoId, reportDate: '2026-03-10', eventDate: '2026-03-08' });
            await seedIndicatorCase('M2B', { geoLocationId: medianTwoId, reportDate: '2026-03-10', eventDate: '2026-03-05' });

            analystToken = ( await createScopedTestUser('dashboard-ind-analyst', provinceIndId, 'ANALYTICS') ).token;
            analystEmptyToken = ( await createScopedTestUser('dashboard-ind-analyst-empty', null, 'ANALYTICS') ).token;
            userIndToken = ( await createScopedTestUser('dashboard-ind-user', provinceIndId) ).token;
        });

        describe('surface and roles', () => {

            it.each(TEST_ROLES)('answers 200 to %s', async ( role ) => {
                const response = await getIndicators(authHeader(role));
                expect(response.status).toBe(200);
                expect(response.body.ok).toBe(true);
                expect(typeof response.body.message).toBe('string');
            });

            it('answers 403 AUTH_ROLE_FORBIDDEN to an authenticated user without roles and 401 without a token', async () => {
                const forbidden = await getIndicators(authHeaderWithoutRole());
                expect(forbidden.status).toBe(403);
                expect(forbidden.body.code).toBe('AUTH_ROLE_FORBIDDEN');
                expect(( await request(app).get(indicators) ).status).toBe(401);
            });

            it('returns every block of the contract', async () => {
                const data = await analystData();
                expect(Object.keys(data).sort()).toEqual(
                    ['causality', 'closure', 'deaths', 'period', 'previousPeriod', 'scope', 'severity', 'timeliness', 'volume'].sort()
                );
            });
        });

        describe('period', () => {

            it('defaults to the 30 days ending today and the 30 before them', async () => {
                const data = ( await getIndicators(authHeader('ADMIN')) ).body.data;
                const today = localToday();
                expect(data.period).toEqual({ from: shiftDays(today, -29), to: today, days: 30 });
                expect(data.previousPeriod).toEqual({ from: shiftDays(today, -59), to: shiftDays(today, -30), days: 30 });
            });

            it('derives from as to minus 29 when only to travels', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), 'to=2026-03-31') ).body.data;
                expect(data.period.from).toBe('2026-03-02');
            });

            it('resolves the previous period of January as the whole of December', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), 'from=2026-01-01&to=2026-01-31') ).body.data;
                expect(data.period.days).toBe(31);
                expect(data.previousPeriod).toEqual({ from: '2025-12-01', to: '2025-12-31', days: 31 });
            });

            it.each([
                ['from later than to', 'from=2026-05-01&to=2026-04-01'],
                ['a future to', `to=${ shiftDays(localToday(), 1) }`],
                ['a range of 367 days', 'from=2025-01-01&to=2026-01-02'],
                ['a malformed date', 'from=2026-13-01'],
                ['a timestamp instead of a date', 'from=2026-03-01T00:00:00Z'],
                ['a malformed geoLocationId', 'geoLocationId=not-a-uuid']
            ])('answers 400 to %s', async ( _label, query ) => {
                const response = await getIndicators(authHeader('ADMIN'), query);
                expect(response.status).toBe(400);
                expect(response.body.ok).toBe(false);
            });

            it('the invalid period 400 carries dashboard.invalidPeriod', async () => {
                const response = await getIndicators(authHeader('ADMIN'), 'from=2026-05-01&to=2026-04-01&lang=en');
                expect(response.body.errors).toContain('the range cannot exceed 366 days');
            });

            it('counts both ends of the period and puts from minus 1 in previous', async () => {
                const data = await analystData();
                expect(data.volume.total).toEqual({ current: 6, previous: 1 });
                const onlyFrom = await analystData('from=2026-03-01&to=2026-03-01');
                const onlyTo = await analystData('from=2026-03-31&to=2026-03-31');
                expect(onlyFrom.volume.total).toEqual({ current: 1, previous: 1 });
                expect(onlyTo.volume.total.current).toBe(1);
            });
        });

        describe('scope', () => {

            it('an analyst of territory A counts nothing of territory B in any block', async () => {
                const data = await analystData();
                expect(data.scope).toEqual({ restricted: true, hasAssignments: true, geoLocationId: null });
                expect(data.volume.total.current).toBe(6);
                expect(data.deaths.total.current).toBe(4);
                expect(data.causality.categories.D).toBe(1);
                expect(data.timeliness.withEventDate).toBe(5);
            });

            it('the same analyst gets 200 with zeros for territory B, identical to an unknown UUID', async () => {
                const foreign = await getIndicators(bearer(analystToken), `${ period }&geoLocationId=${ provinceOtherId }`);
                const unknown = await getIndicators(bearer(analystToken), `${ period }&geoLocationId=00000000-0000-4000-8000-000000000001`);
                expect(foreign.status).toBe(200);
                expect(unknown.status).toBe(200);
                expect(foreign.body.data.volume.total).toEqual({ current: 0, previous: 0 });
                expect(foreign.body.data.closure.closedCases).toBe(0);
                expect(foreign.body.data.timeliness.medianDays).toBeNull();
                const strip = ( data: { scope: Record<string, unknown> } ) => ({ ...data, scope: { ...data.scope, geoLocationId: null } });
                expect(strip(foreign.body.data)).toEqual(strip(unknown.body.data));
                expect(foreign.body.data.scope.geoLocationId).toBe(provinceOtherId);
            });

            it('an ADMIN filtering by territory A counts A and its descendants only', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), `${ period }&geoLocationId=${ provinceIndId }`) ).body.data;
                expect(data.scope).toEqual({ restricted: true, hasAssignments: true, geoLocationId: provinceIndId });
                expect(data.volume.total).toEqual({ current: 6, previous: 1 });
                expect(data.closure.closedCases).toBe(2);
            });

            it('an analyst without assignments gets 200 with zeros, null medians and hasAssignments false', async () => {
                const response = await getIndicators(bearer(analystEmptyToken), period);
                expect(response.status).toBe(200);
                const data = response.body.data;
                expect(data.scope).toEqual({ restricted: true, hasAssignments: false, geoLocationId: null });
                expect(data.volume.total).toEqual({ current: 0, previous: 0 });
                expect(data.timeliness.medianDays).toBeNull();
                expect(data.closure.medianDaysToClose).toBeNull();
                expect(Object.values(data.closure.stageMedianDays).every(( value ) => value === null )).toBe(true);
            });
        });

        describe('volume and severity', () => {

            it('volume.total.current matches the case listing of the same non-admin user', async () => {
                const listing = await request(app)
                    .get('/api/esavi-cases?reportDateFrom=2026-03-01&reportDateTo=2026-03-31')
                    .set(bearer(userIndToken));
                expect(listing.status).toBe(200);
                const data = ( await getIndicators(bearer(userIndToken), period) ).body.data;
                expect(data.volume.total.current).toBe(listing.body.data.count);
            });

            it('splits volume by notification type and the three parts add up to the total in both periods', async () => {
                const data = await analystData();
                expect(data.volume.byNotificationType).toEqual({
                    SEVERE: { current: 3, previous: 1 },
                    NON_SEVERE: { current: 1, previous: 0 },
                    none: { current: 2, previous: 0 }
                });
                for( const side of ['current', 'previous'] as const ) {
                    const { SEVERE, NON_SEVERE, none } = data.volume.byNotificationType;
                    expect(SEVERE[side] + NON_SEVERE[side] + none[side]).toBe(data.volume.total[side]);
                }
            });

            it('classified plus unclassified is the total and serious never exceeds classified', async () => {
                const data = await analystData();
                expect(data.severity.classified).toEqual({ current: 3, previous: 1 });
                expect(data.severity.serious).toEqual({ current: 2, previous: 1 });
                expect(data.severity.unclassified).toEqual({ current: 3, previous: 0 });
                for( const side of ['current', 'previous'] as const ) {
                    expect(data.severity.classified[side] + data.severity.unclassified[side]).toBe(data.volume.total[side]);
                    expect(data.severity.serious[side]).toBeLessThanOrEqual(data.severity.classified[side]);
                }
            });

            it('a case with causedDeath and causedHospitalization adds 1 to each criterion', async () => {
                const data = await analystData();
                expect(data.severity.criteria).toEqual({
                    death: 2, disability: 0, congenitalAnomaly: 0, fetalDeath: 0,
                    lifeThreatening: 0, hospitalization: 1, abortion: 0, otherCondition: 0
                });
            });
        });

        describe('deaths', () => {

            it('a case with death in the three sources counts once', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), `from=2026-03-01&to=2026-03-01&geoLocationId=${ provinceIndId }`) ).body.data;
                expect(data.deaths.total.current).toBe(1);
            });

            it('three cases with death in one source each add up to 3, on top of the one with all three', async () => {
                const data = await analystData();
                expect(data.deaths.total).toEqual({ current: 4, previous: 1 });
            });

            it('a deleted investigationAutopsy counts neither as death nor as performed autopsy', async () => {
                const data = await analystData();
                expect(data.deaths.autopsyPerformed).toBe(1);
                expect(data.deaths.autopsyRequested).toBe(1);
            });
        });

        describe('timeliness', () => {

            it('with a 30-day deadline, 30 days is on time and 31 is not; a case without eventDate is counted apart', async () => {
                const data = await analystData();
                expect(data.timeliness).toEqual({ withEventDate: 5, withoutEventDate: 1, medianDays: 10, onTime: 4, deadlineDays: 30 });
            });

            it('the median of 2, 4 and 10 days is 4', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), `${ period }&geoLocationId=${ medianThreeId }`) ).body.data;
                expect(data.timeliness.medianDays).toBe(4);
            });

            it('the median of 2 and 5 days is 3.5', async () => {
                const data = ( await getIndicators(authHeader('ADMIN'), `${ period }&geoLocationId=${ medianTwoId }`) ).body.data;
                expect(data.timeliness.medianDays).toBe(3.5);
            });

            it('without the deadline configuration nor environment variable: 200, onTime and deadlineDays null, warning logged', async () => {
                const row = await SystemConfig.findOne({ where: { code: 'ESAVI_NOTIFICATION_DEADLINE_DAYS', scope: 'NOTIFICATION' } });
                const envValue = process.env.ESAVI_NOTIFICATION_DEADLINE_DAYS;
                delete process.env.ESAVI_NOTIFICATION_DEADLINE_DAYS;
                const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;
                await row!.update({ isActive: false });
                try {
                    const response = await getIndicators(bearer(analystToken), period);
                    expect(response.status).toBe(200);
                    expect(response.body.data.timeliness).toEqual({ withEventDate: 5, withoutEventDate: 1, medianDays: 10, onTime: null, deadlineDays: null });
                    const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
                    expect(added).toContain('ESAVI-DASH-007 - ESAVI_NOTIFICATION_DEADLINE_DAYS missing or invalid, onTime disabled');
                } finally {
                    await row!.update({ isActive: true });
                    if( envValue !== undefined ) process.env.ESAVI_NOTIFICATION_DEADLINE_DAYS = envValue;
                }
            });
        });

        describe('closure', () => {

            it('counts cases closed in the period whatever their reportDate, and leaves a reopened one out', async () => {
                const data = await analystData();
                expect(data.closure.closedCases).toBe(2);
                expect(data.closure.medianDaysToClose).toBe(15);
            });

            it('a stage without EndedAt stays out of its median, and a stage nobody ended is null', async () => {
                const data = await analystData();
                expect(data.closure.stageMedianDays).toEqual({
                    CLASSIFICATION: 3, NOTIFICATION: null, INVESTIGATION: null, FINAL_CLASSIFICATION: null
                });
            });
        });

        describe('causality', () => {

            it('applies the main category rule: D first, then precedence 1, then the first block marked, else UNCLASSIFIED', async () => {
                const data = await analystData();
                expect(data.causality.categories).toEqual({ A: 1, B: 2, C: 0, D: 1, UNCLASSIFIED: 1 });
            });

            it('the totals add up', async () => {
                const data = await analystData();
                expect(data.causality.withFinalClassification).toBe(5);
                expect(data.causality.withoutFinalClassification).toBe(1);
                expect(data.causality.withFinalClassification + data.causality.withoutFinalClassification).toBe(data.volume.total.current);
                const categoriesSum = Object.values(data.causality.categories as Record<string, number>).reduce(( sum, value ) => sum + value, 0 );
                expect(categoriesSum).toBe(data.causality.withFinalClassification);
            });

            it('an A case with vaccineProduct and stress adds 1 to each subcategory; stress of a D case does not count', async () => {
                const data = await analystData();
                expect(data.causality.aSubcategories).toEqual({ vaccineProduct: 1, qualityDeviation: 0, programmaticError: 0, stress: 1 });
            });
        });

        describe('exposed data', () => {

            it('the response carries no case or patient identifier at any level', async () => {
                const keys = collectKeys(( await getIndicators(authHeader('SUPERADMIN'), period) ).body);
                for( const forbidden of ['caseId', 'caseCode', 'patientId', 'names', 'lastNames', 'documentNumber', 'healthSystemCode'] ) {
                    expect(keys.has(forbidden)).toBe(false);
                }
            });

            it('scope.geoLocationId echoes the received value', async () => {
                const unknownId = '00000000-0000-4000-8000-000000000002';
                const data = ( await getIndicators(authHeader('ADMIN'), `geoLocationId=${ unknownId }`) ).body.data;
                expect(data.scope.geoLocationId).toBe(unknownId);
            });
        });

        describe('no writes', () => {

            it('calling ESAVI-DASH-007 leaves updatedAt, appDetails and sysDetails of the fixture untouched', async () => {
                const caseIds = Object.values(indicatorIds);
                const attributes = ['caseId', 'updatedAt', 'appDetails', 'sysDetails'];
                const snapshot = async () => JSON.stringify(await Promise.all([
                    EsaviCase.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    CaseWorkflow.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    Classification.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    Notification.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    FinalClassification.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] })
                ]));
                const before = await snapshot();
                expect(( await getIndicators(bearer(analystToken), period) ).status).toBe(200);
                expect(( await getIndicators(authHeader('ADMIN'), period) ).status).toBe(200);
                expect(await snapshot()).toBe(before);
            });
        });
    });

    describe('series and distributions — ESAVI-DASH-008 / ESAVI-DASH-009', () => {

        const epiCurve = '/api/dashboard/epi-curve';
        const distributions = '/api/dashboard/distributions';
        const indicatorsPath = '/api/dashboard/indicators';
        const curvePeriod = 'from=2026-01-01&to=2026-01-28';
        const distPeriod = 'from=2026-02-01&to=2026-02-28';
        const seriesIds: Record<string, string> = {};
        const geo: Record<string, string> = {};

        let analystPToken: string;
        let analystOverlapToken: string;
        let analystCantonToken: string;
        let coded: { id: string; name: string };

        interface GeoRow { geoLocationId: string | null; kind: string; name: string | null; latitude: number | null; longitude: number | null; total: number; serious: number }
        interface VaccineRow { key: string; label: string | null; coded: boolean; cases: number; serious: number }
        interface EpiWeekRow { label: string; partial: boolean; serious: number; nonSerious: number; unclassified: number; total: number }

        interface SeriesCaseOptions {
            geoLocationId: string | null;
            reportDate: string;
            classification?: { age?: number | null; unit?: string | null; isSeriousEvent?: boolean };
            sex?: string;
            vaccines?: { name?: string | null; whodrugId?: string; suspected: boolean; active?: boolean }[];
            investigation?: {
                administration?: Record<string, unknown>;
                coldChain?: Record<string, unknown>;
            };
        }

        const lockedItemId = async ( typeCode: string, value: string ): Promise<string> => {
            const item = await CatalogItem.findOne({
                where: { value, isValueLocked: true },
                include: [{ model: CatalogType, as: 'catalogType', where: { code: typeCode }, attributes: [] }]
            });
            return item!.getDataValue('catalogItemId');
        };

        const seedSeriesCase = async ( label: string, options: SeriesCaseOptions ): Promise<string> => {
            const facility = await HealthFacility.create({
                localCode: `${ tag }S${ label }`, name: `${ tag } S${ label }`, geoLocationId: options.geoLocationId
            });
            const patient = await Patient.create({
                names: esaviCrypt(`Series ${ label }`),
                lastNames: esaviCrypt(`Probe ${ suffix }`),
                documentNumber: esaviCrypt(`DSS${ label }${ suffix }`),
                healthSystemCode: `DSS${ label }${ suffix }`,
                sexItemId: options.sex ? await lockedItemId('sex', options.sex) : null
            });
            const esaviCase = await EsaviCase.create({
                caseCode: `${ tag }-S${ label }`,
                patientId: patient.getDataValue('patientId'),
                healthFacilityId: facility.getDataValue('healthFacilityId'),
                reportDate: options.reportDate,
                isActive: true
            });
            const caseId = esaviCase.getDataValue('caseId');
            await seedCaseWorkflow(caseId);
            if( options.classification ) {
                const { age, unit, isSeriousEvent } = options.classification;
                await Classification.create({
                    caseId,
                    age: age ?? null,
                    ageUnitItemId: unit ? await lockedItemId('ageUnit', unit) : null,
                    isSeriousEvent: isSeriousEvent ?? false
                });
            }
            if( options.vaccines ) {
                const notification = await Notification.create({ caseId, notificationType: 'SEVERE', esaviDescription: `Series ${ label }` });
                for( const vaccine of options.vaccines ) {
                    await NotificationVaccine.create({
                        notificationId: notification.getDataValue('notificationId'),
                        vaccineName: vaccine.name ?? null,
                        vaccineWhodrugId: vaccine.whodrugId ?? null,
                        isSuspected: vaccine.suspected,
                        isActive: vaccine.active ?? true,
                        sortOrder: 0
                    });
                }
            }
            if( options.investigation ) {
                const investigation = await Investigation.create({ caseId });
                const investigationId = investigation.getDataValue('investigationId');
                if( options.investigation.administration ) {
                    await InvestigationAdministrationError.create({ investigationId, ...options.investigation.administration });
                }
                if( options.investigation.coldChain ) {
                    await InvestigationColdChain.create({ investigationId, ...options.investigation.coldChain });
                }
            }
            seriesIds[label] = caseId;
            return caseId;
        };

        const fetchPath = ( path: string, headers: Record<string, string>, query: string ) =>
            request(app).get(`${ path }${ query ? `?${ query }` : '' }`).set(headers);
        const curveOf = async ( headers: Record<string, string>, query: string ) => ( await fetchPath(epiCurve, headers, query) ).body.data;
        const distOf = async ( headers: Record<string, string>, query: string ) => ( await fetchPath(distributions, headers, query) ).body.data;
        const totalOf = async ( headers: Record<string, string>, query: string ): Promise<number> =>
            ( await fetchPath(indicatorsPath, headers, query) ).body.data.volume.total.current;
        const provinceQuery = ( query: string ) => `${ query }&geoLocationId=${ geo.P }`;

        const vaccineByKey = ( data: { vaccines: { items: VaccineRow[] } }, key: string ) =>
            data.vaccines.items.find(( item ) => item.key === key );
        const cell = ( data: { sexAge: { bands: string[]; sexes: string[]; matrix: number[][] } }, band: string, sex: string ): number =>
            data.sexAge.matrix[data.sexAge.bands.indexOf(band)][data.sexAge.sexes.indexOf(sex)];
        const matrixSum = ( matrix: number[][] ): number => matrix.flat().reduce(( sum, value ) => sum + value, 0 );
        const rowsSum = ( rows: GeoRow[] ): number => rows.reduce(( sum, row ) => sum + row.total, 0 );
        const rowNamed = ( rows: GeoRow[], id: string ) => rows.find(( row ) => row.geoLocationId === id );

        const keysOf = ( value: unknown, keys: Set<string> = new Set() ): Set<string> => {
            if( Array.isArray(value) ) value.forEach(( item ) => keysOf(item, keys) );
            else if( value && typeof value === 'object' ) {
                for( const [key, nested] of Object.entries(value) ) {
                    keys.add(key);
                    keysOf(nested, keys);
                }
            }
            return keys;
        };

        beforeAll(async () => {
            await seedUserWithoutRole();

            const baseLevel = ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) || 0;
            geo.X = await createGeoLocation('CTRYSER', null, baseLevel + 1);
            geo.P = await createGeoLocation('PROVSER', geo.X, baseLevel + 2);
            geo.CA = await createGeoLocation('CANTASER', geo.P, baseLevel + 3);
            geo.CB = await createGeoLocation('CANTBSER', geo.P, baseLevel + 3);
            geo.I = await createGeoLocation('CANTISER', geo.P, baseLevel + 3);
            await GeoLocation.update({ isActive: false }, { where: { geoLocationId: geo.I } });
            geo.B = await createGeoLocation('PROVBSER', null, baseLevel + 1);
            geo.EMPTY = await createGeoLocation('PROVESER', null, baseLevel + 1);
            geo.TOP = await createGeoLocation('PROVTSER', null, baseLevel + 1);
            await GeoLocation.update({ latitude: -1.25, longitude: -78.5 }, { where: { geoLocationId: geo.CA } });

            const whodrug = await VaccineWhodrug.create({ drugCode: `DSER${ suffix }`, drugName: `Coded Vaccine ${ suffix }` });
            coded = { id: whodrug.getDataValue('vaccineWhodrugId'), name: `Coded Vaccine ${ suffix }` };

            await seedSeriesCase('K1', { geoLocationId: geo.CA, reportDate: '2026-01-02', classification: { isSeriousEvent: true } });
            await seedSeriesCase('K2', { geoLocationId: geo.CA, reportDate: '2025-12-30', classification: { isSeriousEvent: true } });
            await seedSeriesCase('K3', { geoLocationId: geo.CA, reportDate: '2026-01-06', classification: { isSeriousEvent: false } });
            await seedSeriesCase('K4', { geoLocationId: geo.CB, reportDate: '2026-01-27' });

            const day = '2026-02-10';
            await seedSeriesCase('V1', {
                geoLocationId: geo.CA, reportDate: day, sex: 'FEMALE',
                classification: { age: 11, unit: 'MONTHS', isSeriousEvent: true },
                vaccines: [
                    { name: ' Pfizer ', suspected: true },
                    { name: 'PFIZER', suspected: true },
                    { name: 'Moderna', suspected: true },
                    { name: 'Astra', suspected: false }
                ],
                investigation: { administration: { hadHandlingError: 'YES' }, coldChain: { storageRangeDeviation: true } }
            });
            await seedSeriesCase('V2', {
                geoLocationId: geo.CA, reportDate: day, sex: 'MALE',
                classification: { age: 12, unit: 'MONTHS' },
                vaccines: [{ name: 'pfizer', suspected: true }, { whodrugId: coded.id, suspected: true }, { name: 'Inactive', suspected: true, active: false }],
                investigation: {
                    administration: { hadPrescriptionError: 'YES', hadPreparationError: 'YES', hadImproperAdministration: 'YES' },
                    coldChain: { storageProcedureFollowed: 'NO' }
                }
            });
            await seedSeriesCase('V3', {
                geoLocationId: geo.CB, reportDate: day,
                classification: { age: 364, unit: 'DAYS' },
                investigation: {}
            });
            await seedSeriesCase('V4', {
                geoLocationId: geo.CB, reportDate: day, sex: 'UNKNOWN',
                classification: { age: 365, unit: 'DAYS' },
                investigation: {
                    administration: { hadHandlingError: 'NO', hadContaminatedVaccine: 'UNKNOWN' },
                    coldChain: { storageProcedureFollowed: 'YES' }
                }
            });
            await seedSeriesCase('V5', {
                geoLocationId: geo.P, reportDate: day,
                classification: { age: 17, unit: 'YEARS' },
                investigation: {
                    administration: { hadContaminatedVaccine: 'YES', deletedAt: new Date() },
                    coldChain: { storageDiluentNotUsable: 'YES', deletedAt: new Date() }
                }
            });
            await seedSeriesCase('V6', { geoLocationId: geo.P, reportDate: day });
            const ages: [string, number][] = [['A18', 18], ['A49', 49], ['A50', 50], ['A79', 79], ['A80', 80]];
            for( const [label, age] of ages ) {
                await seedSeriesCase(label, { geoLocationId: geo.CA, reportDate: day, sex: 'FEMALE', classification: { age, unit: 'YEARS' } });
            }
            await seedSeriesCase('ANULL', { geoLocationId: geo.CA, reportDate: day, classification: { age: null, unit: 'YEARS' } });
            await seedSeriesCase('UNULL', { geoLocationId: geo.CA, reportDate: day, classification: { age: 30, unit: null } });
            await seedSeriesCase('INACT', { geoLocationId: geo.I, reportDate: day });
            await seedSeriesCase('NOGEO', { geoLocationId: null, reportDate: day });
            await seedSeriesCase('BSIDE', {
                geoLocationId: geo.B, reportDate: day, sex: 'FEMALE',
                classification: { age: 30, unit: 'YEARS', isSeriousEvent: true },
                vaccines: [{ name: 'Pfizer', suspected: true }],
                investigation: { administration: { hadHandlingError: 'YES' } }
            });
            await seedSeriesCase('TOP', {
                geoLocationId: geo.TOP, reportDate: day,
                vaccines: Array.from({ length: 12 }, ( _, index ) => ({ name: `VAX${ `${ index }`.padStart(2, '0') }`, suspected: true }))
            });

            analystPToken = ( await createScopedTestUser('dashboard-ser-p', geo.P, 'ANALYTICS') ).token;
            const overlap = await createScopedTestUser('dashboard-ser-overlap', geo.P, 'ANALYTICS');
            await AppUserGeoLocation.create({ userId: overlap.userId, geoLocationId: geo.CA, validFrom: new Date(), isActive: true });
            analystOverlapToken = overlap.token;
            analystCantonToken = ( await createScopedTestUser('dashboard-ser-canton', geo.CA, 'ANALYTICS') ).token;
        });

        describe('surface and roles', () => {

            it.each(TEST_ROLES)('both endpoints answer 200 to %s', async ( role ) => {
                for( const path of [epiCurve, distributions] ) {
                    const response = await fetchPath(path, authHeader(role), curvePeriod);
                    expect(response.status).toBe(200);
                    expect(response.body.ok).toBe(true);
                    expect(typeof response.body.message).toBe('string');
                }
            });

            it('both answer 403 AUTH_ROLE_FORBIDDEN without roles and 401 without a token', async () => {
                for( const path of [epiCurve, distributions] ) {
                    const forbidden = await fetchPath(path, authHeaderWithoutRole(), '');
                    expect(forbidden.status).toBe(403);
                    expect(forbidden.body.code).toBe('AUTH_ROLE_FORBIDDEN');
                    expect(( await request(app).get(path) ).status).toBe(401);
                }
            });

            it('both reject an invalid period with 400', async () => {
                for( const path of [epiCurve, distributions] ) {
                    expect(( await fetchPath(path, authHeader('ADMIN'), 'from=2026-05-01&to=2026-04-01') ).status).toBe(400);
                }
            });
        });

        describe('epi curve — ESAVI-DASH-008', () => {

            it('returns the five continuous weeks of the period, partial at both ends', async () => {
                const data = await curveOf(authHeader('ADMIN'), provinceQuery(curvePeriod));
                expect(data.weeks.map(( week: EpiWeekRow ) => [week.label, week.partial] )).toEqual([
                    ['2025-SE53', true], ['2026-SE01', false], ['2026-SE02', false], ['2026-SE03', false], ['2026-SE04', true]
                ]);
            });

            it('a week without cases carries the four counters at 0', async () => {
                const data = await curveOf(authHeader('ADMIN'), provinceQuery(curvePeriod));
                const empty = data.weeks.find(( week: EpiWeekRow ) => week.label === '2026-SE02' );
                expect(empty).toMatchObject({ serious: 0, nonSerious: 0, unclassified: 0, total: 0 });
            });

            it('a case of 2026-01-02 counts in 2025-SE53 and one of 2025-12-30 is out of the period', async () => {
                const data = await curveOf(authHeader('ADMIN'), provinceQuery(curvePeriod));
                const first = data.weeks[0];
                expect(first).toMatchObject({ label: '2025-SE53', serious: 1, total: 1 });
            });

            it('splits every week into serious, nonSerious and unclassified, which add up to total', async () => {
                const data = await curveOf(authHeader('ADMIN'), provinceQuery(curvePeriod));
                expect(data.weeks.map(( week: EpiWeekRow ) => [week.serious, week.nonSerious, week.unclassified] )).toEqual([
                    [1, 0, 0], [0, 1, 0], [0, 0, 0], [0, 0, 0], [0, 0, 1]
                ]);
                for( const week of data.weeks as EpiWeekRow[] ) {
                    expect(week.serious + week.nonSerious + week.unclassified).toBe(week.total);
                }
            });

            it.each([
                ['an ADMIN filtered by the province', () => authHeader('ADMIN'), true],
                ['an ADMIN without filter', () => authHeader('ADMIN'), false],
                ['a restricted analyst', () => bearer(analystPToken), false]
            ])('the sum of total equals volume.total.current of ESAVI-DASH-007 for %s', async ( _label, headers, filtered ) => {
                const query = filtered ? provinceQuery(curvePeriod) : curvePeriod;
                const data = await curveOf(headers(), query);
                const sum = data.weeks.reduce(( acc: number, week: EpiWeekRow ) => acc + week.total, 0 );
                expect(sum).toBe(await totalOf(headers(), query));
            });
        });

        describe('vaccines — ESAVI-DASH-009', () => {

            it('normalizes free text: " Pfizer ", "PFIZER" and "pfizer" are one group T:PFIZER, and a case with it twice counts once', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(vaccineByKey(data, 'T:PFIZER')).toEqual({ key: 'T:PFIZER', label: 'PFIZER', coded: false, cases: 2, serious: 1 });
            });

            it('a case with two different suspected vaccines adds 1 to each', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(vaccineByKey(data, 'T:MODERNA')).toMatchObject({ cases: 1, serious: 1 });
                expect(vaccineByKey(data, 'T:PFIZER')!.cases).toBe(2);
            });

            it('a coded vaccine is grouped by vaccineWhodrugId with its drugName', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(vaccineByKey(data, `W:${ coded.id }`)).toEqual({ key: `W:${ coded.id }`, label: coded.name, coded: true, cases: 1, serious: 0 });
            });

            it('rows with isSuspected false or inactive do not count', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(vaccineByKey(data, 'T:ASTRA')).toBeUndefined();
                expect(vaccineByKey(data, 'T:INACTIVE')).toBeUndefined();
            });

            it('casesWithoutSuspectedVaccine counts the cases of the universe without any suspected row', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                const total = await totalOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(data.vaccines.casesWithoutSuspectedVaccine).toBe(total - 2);
            });

            it('with 12 vaccines the top 10 go to items and others counts distinct cases of the remaining 2', async () => {
                const data = await distOf(authHeader('ADMIN'), `${ distPeriod }&geoLocationId=${ geo.TOP }`);
                expect(data.vaccines.items.map(( item: VaccineRow ) => item.key )).toEqual(
                    Array.from({ length: 10 }, ( _, index ) => `T:VAX${ `${ index }`.padStart(2, '0') }` )
                );
                expect(data.vaccines.others).toEqual({ cases: 1, serious: 0 });
            });
        });

        describe('sex and age — ESAVI-DASH-009', () => {

            it('the matrix is always 9 x 4 in the order of bands and sexes, and adds up to the universe', async () => {
                const query = provinceQuery(distPeriod);
                const data = await distOf(authHeader('ADMIN'), query);
                expect(data.sexAge.bands).toEqual(['LT_1Y', 'Y1_17', 'Y18_24', 'Y25_49', 'Y50_59', 'Y60_69', 'Y70_79', 'Y80_PLUS', 'UNKNOWN']);
                expect(data.sexAge.sexes).toEqual(['FEMALE', 'MALE', 'UNKNOWN', 'NONE']);
                expect(data.sexAge.matrix).toHaveLength(9);
                for( const row of data.sexAge.matrix ) expect(row).toHaveLength(4);
                expect(matrixSum(data.sexAge.matrix)).toBe(await totalOf(authHeader('ADMIN'), query));
            });

            it('converts months and days to completed years at the one-year border', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(cell(data, 'LT_1Y', 'FEMALE')).toBe(1);
                expect(cell(data, 'LT_1Y', 'NONE')).toBe(1);
                expect(cell(data, 'Y1_17', 'MALE')).toBe(1);
                expect(cell(data, 'Y1_17', 'UNKNOWN')).toBe(1);
            });

            it('places 17, 18, 49, 50, 79 and 80 years in their bands', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(cell(data, 'Y1_17', 'NONE')).toBe(1);
                expect(cell(data, 'Y18_24', 'FEMALE')).toBe(1);
                expect(cell(data, 'Y25_49', 'FEMALE')).toBe(1);
                expect(cell(data, 'Y50_59', 'FEMALE')).toBe(1);
                expect(cell(data, 'Y70_79', 'FEMALE')).toBe(1);
                expect(cell(data, 'Y80_PLUS', 'FEMALE')).toBe(1);
            });

            it('a case without classification, with null age or with null unit goes to UNKNOWN, and a patient without sex to NONE', async () => {
                const data = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(cell(data, 'UNKNOWN', 'NONE')).toBe(3);
            });
        });

        describe('geography — ESAVI-DASH-009', () => {

            it('an ADMIN without geoLocationId gets the units without parent, also at 0, and unlocated; the rows add up to the universe', async () => {
                const data = await distOf(authHeader('ADMIN'), distPeriod);
                const rows: GeoRow[] = data.geography.rows;
                expect(rowNamed(rows, geo.EMPTY)).toMatchObject({ kind: 'unit', total: 0, serious: 0 });
                expect(rowNamed(rows, geo.P)).toBeUndefined();
                expect(rowNamed(rows, geo.X)!.total).toBe(13);
                const unlocated = rows.find(( row ) => row.kind === 'unlocated' );
                expect(unlocated!.total).toBeGreaterThanOrEqual(2);
                expect(unlocated).toMatchObject({ geoLocationId: null, name: null, latitude: null, longitude: null });
                expect(rowsSum(rows)).toBe(await totalOf(authHeader('ADMIN'), distPeriod));
            });

            it('with geoLocationId of the province the rows are its active cantons, plus self, ordered by total', async () => {
                const query = provinceQuery(distPeriod);
                const data = await distOf(authHeader('ADMIN'), query);
                const rows: GeoRow[] = data.geography.rows;
                expect(rows.map(( row ) => [row.kind, row.geoLocationId, row.total] )).toEqual([
                    ['unit', geo.CA, 9],
                    ['unit', geo.CB, 2],
                    ['self', null, 2]
                ]);
                expect(rowNamed(rows, geo.CA)).toMatchObject({ name: `CANTASER ${ suffix }`, latitude: -1.25, longitude: -78.5, serious: 1 });
                expect(rowsSum(rows)).toBe(await totalOf(authHeader('ADMIN'), query));
            });

            it('a restricted user assigned to a province and to one of its cantons sees a single row: the province', async () => {
                const data = await distOf(bearer(analystOverlapToken), distPeriod);
                expect(data.geography.rows.map(( row: GeoRow ) => [row.geoLocationId, row.total] )).toEqual([[geo.P, 13]]);
            });

            it('a restricted user never receives a child outside the scope, neither its name nor its geoLocationId', async () => {
                const response = await fetchPath(distributions, bearer(analystCantonToken), provinceQuery(distPeriod));
                const rows: GeoRow[] = response.body.data.geography.rows;
                expect(rows.map(( row ) => row.geoLocationId )).toEqual([geo.CA]);
                const body = JSON.stringify(response.body);
                expect(body).not.toContain(geo.CB);
                expect(body).not.toContain(`CANTBSER ${ suffix }`);
            });

            it('a restricted user of a canton querying the country sees its cases in unlocated and no province', async () => {
                const query = `${ distPeriod }&geoLocationId=${ geo.X }`;
                const response = await fetchPath(distributions, bearer(analystCantonToken), query);
                const rows: GeoRow[] = response.body.data.geography.rows;
                expect(rows.map(( row ) => [row.kind, row.total] )).toEqual([['unlocated', 9]]);
                expect(JSON.stringify(response.body)).not.toContain(`PROVSER ${ suffix }`);
                expect(rowsSum(rows)).toBe(await totalOf(bearer(analystCantonToken), query));
            });

            it('no row carries geoPolygon', async () => {
                const keys = keysOf(( await distOf(authHeader('ADMIN'), distPeriod) ).geography);
                expect(keys.has('geoPolygon')).toBe(false);
            });
        });

        describe('programmatic failures — ESAVI-DASH-009', () => {

            it('counts the investigated cases and the investigations without each record', async () => {
                const { programmatic } = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(programmatic.investigatedCases).toBe(5);
                expect(programmatic.withoutAdministrationRecord).toBe(2);
                expect(programmatic.withoutColdChainRecord).toBe(2);
            });

            it('only YES is an administration error, and a case with three errors adds 1 to anyError', async () => {
                const { programmatic } = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(programmatic.administrationErrors).toEqual({
                    prescriptionError: 1, contaminatedVaccine: 0, abnormalVaccineConditions: 0,
                    preparationError: 1, handlingError: 1, improperAdministration: 1, anyError: 2
                });
            });

            it('storageRangeDeviation true and storageProcedureFollowed NO are failures; YES is not; deleted rows do not count', async () => {
                const { programmatic } = await distOf(authHeader('ADMIN'), provinceQuery(distPeriod));
                expect(programmatic.coldChainFailures).toEqual({
                    rangeDeviation: 1, procedureNotFollowed: 1, vaccineNotUsable: 0, diluentNotUsable: 0,
                    partiallyReconstitutedVaccine: 0, otherObjectPresent: 0, anyFailure: 2
                });
            });
        });

        describe('scope and exposed data', () => {

            it('an analyst of territory A receives no count of territory B in either endpoint', async () => {
                const curve = await curveOf(bearer(analystPToken), distPeriod);
                const data = await distOf(bearer(analystPToken), distPeriod);
                expect(curve.weeks.reduce(( acc: number, week: EpiWeekRow ) => acc + week.total, 0 )).toBe(13);
                expect(matrixSum(data.sexAge.matrix)).toBe(13);
                expect(vaccineByKey(data, 'T:PFIZER')!.cases).toBe(2);
                expect(data.programmatic.administrationErrors.handlingError).toBe(1);
                expect(cell(data, 'Y25_49', 'FEMALE')).toBe(1);
            });

            it.each([
                ['a foreign territory', () => geo.B],
                ['an unknown UUID', () => '00000000-0000-4000-8000-000000000067']
            ])('with geoLocationId of %s both endpoints answer 200 with zeros and no geography rows', async ( _label, target ) => {
                const query = `${ distPeriod }&geoLocationId=${ target() }`;
                const curve = await fetchPath(epiCurve, bearer(analystPToken), query);
                const dist = await fetchPath(distributions, bearer(analystPToken), query);
                expect(curve.status).toBe(200);
                expect(dist.status).toBe(200);
                expect(curve.body.data.weeks.every(( week: EpiWeekRow ) => week.total === 0 )).toBe(true);
                expect(dist.body.data.geography.rows).toEqual([]);
                expect(matrixSum(dist.body.data.sexAge.matrix)).toBe(0);
                expect(dist.body.data.vaccines).toEqual({ items: [], others: { cases: 0, serious: 0 }, casesWithoutSuspectedVaccine: 0 });
                expect(dist.body.data.programmatic.investigatedCases).toBe(0);
            });

            it('a foreign territory and an unknown UUID produce identical responses', async () => {
                const strip = ( data: { scope: Record<string, unknown> } ) => ({ ...data, scope: { ...data.scope, geoLocationId: null } });
                for( const path of [epiCurve, distributions] ) {
                    const foreign = ( await fetchPath(path, bearer(analystPToken), `${ distPeriod }&geoLocationId=${ geo.B }`) ).body.data;
                    const unknown = ( await fetchPath(path, bearer(analystPToken), `${ distPeriod }&geoLocationId=00000000-0000-4000-8000-000000000067`) ).body.data;
                    expect(strip(foreign)).toEqual(strip(unknown));
                }
            });

            it('neither response carries a case or patient identifier at any level', async () => {
                for( const path of [epiCurve, distributions] ) {
                    const keys = keysOf(( await fetchPath(path, authHeader('SUPERADMIN'), distPeriod) ).body);
                    for( const forbidden of ['caseId', 'caseCode', 'patientId', 'names', 'lastNames', 'documentNumber', 'healthSystemCode'] ) {
                        expect(keys.has(forbidden)).toBe(false);
                    }
                }
            });
        });

        describe('no writes', () => {

            it('calling ESAVI-DASH-008 and ESAVI-DASH-009 leaves updatedAt, appDetails and sysDetails of the fixture untouched', async () => {
                const caseIds = Object.values(seriesIds);
                const attributes = ['caseId', 'updatedAt', 'appDetails', 'sysDetails'];
                const snapshot = async () => JSON.stringify(await Promise.all([
                    EsaviCase.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    CaseWorkflow.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    Classification.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    Notification.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] }),
                    Investigation.findAll({ where: { caseId: caseIds }, attributes, order: [['caseId', 'ASC']] })
                ]));
                const before = await snapshot();
                for( const path of [epiCurve, distributions] ) {
                    expect(( await fetchPath(path, bearer(analystPToken), distPeriod) ).status).toBe(200);
                    expect(( await fetchPath(path, authHeader('ADMIN'), provinceQuery(distPeriod)) ).status).toBe(200);
                }
                expect(await snapshot()).toBe(before);
            });
        });
    });

    describe('batch alerts — ESAVI-DASH-010', () => {

        const batchAlerts = '/api/dashboard/batch-alerts';
        const batchPeriod = 'from=2025-06-01&to=2025-06-30';
        const listPeriod = 'reportDateFrom=2025-06-01&reportDateTo=2025-06-30';
        const vaccineA = `VACA${ suffix }`;
        const vaccineB = `VACB${ suffix }`;
        const keyA = `T:${ vaccineA }`;
        const keyB = `T:${ vaccineB }`;
        const batchIds: Record<string, string> = {};
        const geo68: Record<string, string> = {};
        const facility68: Record<string, string> = {};

        let userAToken68: string;

        interface BatchAlertRow {
            vaccineKey: string; label: string | null; coded: boolean; batchNumber: string; variants: string[];
            cases: number; suspectedCases: number; serious: number; deaths: number; expiredAtVaccination: number;
            firstReportDate: string; lastReportDate: string; facilities: number; geoUnits: number;
            expirationDates: string[]; reasons: string[];
        }

        interface BatchVaccine { name: string; batch: string | null; suspected?: boolean; vaccinationDate?: string; expirationDate?: string | null }

        interface BatchCaseOptions {
            facility: string;
            reportDate?: string;
            vaccines?: BatchVaccine[];
            serious?: boolean;
            causedDeath?: boolean;
            deathDate?: string;
            autopsyDeath?: boolean;
        }

        const seedBatchCase = async ( label: string, options: BatchCaseOptions ): Promise<string> => {
            const patient = await Patient.create({
                names: esaviCrypt(`Batch ${ label }`),
                lastNames: esaviCrypt(`Probe ${ suffix }`),
                documentNumber: esaviCrypt(`DB${ label }${ suffix }`),
                healthSystemCode: `DB${ label }${ suffix }`
            });
            const esaviCase = await EsaviCase.create({
                caseCode: `${ tag }-B${ label }`,
                patientId: patient.getDataValue('patientId'),
                healthFacilityId: options.facility,
                reportDate: options.reportDate ?? '2025-06-15',
                isActive: true
            });
            const caseId = esaviCase.getDataValue('caseId');
            await seedCaseWorkflow(caseId);
            if( options.serious !== undefined || options.causedDeath !== undefined ) {
                await Classification.create({ caseId, isSeriousEvent: options.serious ?? false, causedDeath: options.causedDeath ?? false });
            }
            if( options.vaccines || options.deathDate ) {
                const notification = await Notification.create({
                    caseId, notificationType: 'SEVERE', esaviDescription: `Batch ${ label }`, deathDate: options.deathDate ?? null
                });
                for( const vaccine of options.vaccines ?? [] ) {
                    await NotificationVaccine.create({
                        notificationId: notification.getDataValue('notificationId'),
                        vaccineName: vaccine.name,
                        batchNumber: vaccine.batch,
                        isSuspected: vaccine.suspected ?? true,
                        vaccinationDate: vaccine.vaccinationDate ?? null,
                        expirationDate: vaccine.expirationDate ?? null,
                        sortOrder: 0
                    });
                }
            }
            if( options.autopsyDeath ) {
                const investigation = await Investigation.create({ caseId });
                await InvestigationAutopsy.create({
                    investigationId: investigation.getDataValue('investigationId'), isDeath: true, isAutopsyPerformed: true
                });
            }
            batchIds[label] = caseId;
            return caseId;
        };

        const createFacility68 = async ( label: string, geoLocationId: string | null ): Promise<string> => {
            const facility = await HealthFacility.create({ localCode: `${ tag }B${ label }`, name: `${ tag } B${ label }`, geoLocationId });
            return facility.getDataValue('healthFacilityId');
        };

        const fetchAlerts = ( headers: Record<string, string>, query: string = batchPeriod ) =>
            request(app).get(`${ batchAlerts }${ query ? `?${ query }` : '' }`).set(headers);
        const alertsOf = async ( headers: Record<string, string>, query: string = batchPeriod ) =>
            ( await fetchAlerts(headers, query) ).body.data;
        const userAData = async () => alertsOf(bearer(userAToken68));
        const countryData = async () => alertsOf(authHeader('ADMIN'), `${ batchPeriod }&geoLocationId=${ geo68.X }`);
        const alertOf = ( data: { alerts: BatchAlertRow[] }, vaccineKey: string, batchNumber: string ): BatchAlertRow | undefined =>
            data.alerts.find(( alert ) => alert.vaccineKey === vaccineKey && alert.batchNumber === batchNumber );
        const ownAlerts = ( data: { alerts: BatchAlertRow[] } ): BatchAlertRow[] =>
            data.alerts.filter(( alert ) => alert.vaccineKey === keyA || alert.vaccineKey === keyB );

        const configRow = async ( code: string ) => SystemConfig.findOne({ where: { code, scope: 'DASHBOARD' } });

        const withBatchConfig = async <T>( changes: Record<string, Record<string, unknown>>, run: () => Promise<T> ): Promise<T> => {
            const originals: [InstanceType<typeof SystemConfig>, Record<string, unknown>][] = [];
            for( const [code, change] of Object.entries(changes) ) {
                const row = await configRow(code);
                const original: Record<string, unknown> = {};
                for( const key of Object.keys(change) ) original[key] = row!.getDataValue(key as never);
                originals.push([row!, original]);
                await row!.update(change);
            }
            try {
                return await run();
            } finally {
                for( const [row, original] of originals ) await row.update(original);
            }
        };

        const keysOf = ( value: unknown, keys: Set<string> = new Set() ): Set<string> => {
            if( Array.isArray(value) ) value.forEach(( item ) => keysOf(item, keys) );
            else if( value && typeof value === 'object' ) {
                for( const [key, nested] of Object.entries(value) ) {
                    keys.add(key);
                    keysOf(nested, keys);
                }
            }
            return keys;
        };

        beforeAll(async () => {
            await seedUserWithoutRole();

            const baseLevel = ( await GeoLocation.max('level', { where: { isActive: true } }) as number ) || 0;
            geo68.X = await createGeoLocation('CTRYBAT', null, baseLevel + 1);
            geo68.A = await createGeoLocation('PROVABAT', geo68.X, baseLevel + 2);
            geo68.CA = await createGeoLocation('CANTABAT', geo68.A, baseLevel + 3);
            geo68.B = await createGeoLocation('PROVBBAT', geo68.X, baseLevel + 2);
            geo68.LIM = await createGeoLocation('PROVLBAT', null, baseLevel + 1);

            facility68.A1 = await createFacility68('A1', geo68.CA);
            facility68.A2 = await createFacility68('A2', geo68.CA);
            facility68.A3 = await createFacility68('A3', geo68.A);
            facility68.B1 = await createFacility68('B1', geo68.B);
            facility68.NOGEO = await createFacility68('NOGEO', null);
            facility68.LIM = await createFacility68('LIM', geo68.LIM);

            await seedBatchCase('L1A', { facility: facility68.A1, reportDate: '2025-06-02', vaccines: [
                { name: vaccineA, batch: 'ab-123', suspected: false, vaccinationDate: '2025-06-10', expirationDate: '2025-06-01' }
            ] });
            await seedBatchCase('L1B', { facility: facility68.A2, reportDate: '2025-06-10', vaccines: [
                { name: vaccineA, batch: 'AB 123', vaccinationDate: '2025-06-08', expirationDate: null }
            ] });
            await seedBatchCase('L1C', { facility: facility68.A1, reportDate: '2025-06-20', vaccines: [
                { name: vaccineA, batch: 'AB.123', vaccinationDate: '2025-06-05', expirationDate: '2025-12-31' },
                { name: vaccineA, batch: 'AB.123', vaccinationDate: '2025-06-05', expirationDate: '2025-12-31' }
            ] });
            await seedBatchCase('L1V2', { facility: facility68.A1, vaccines: [{ name: vaccineB, batch: 'AB123' }] });

            await seedBatchCase('SER1', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineA, batch: 'SER2' }] });
            await seedBatchCase('SER2', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineA, batch: 'SER2' }] });

            await seedBatchCase('ONE1', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineA, batch: 'ONE1' }] });
            await seedBatchCase('ONE2', { facility: facility68.A1, serious: false, vaccines: [{ name: vaccineA, batch: 'ONE1' }] });

            await seedBatchCase('DTH1', { facility: facility68.A1, reportDate: '2025-06-03', deathDate: '2025-06-03', vaccines: [{ name: vaccineA, batch: 'DTH1' }] });
            await seedBatchCase('DTH2', { facility: facility68.A1, reportDate: '2025-06-04', causedDeath: true, vaccines: [{ name: vaccineA, batch: 'DTH2' }] });
            await seedBatchCase('DTH3', { facility: facility68.A1, reportDate: '2025-06-05', autopsyDeath: true, vaccines: [{ name: vaccineA, batch: 'DTH3' }] });

            await seedBatchCase('ALL1', { facility: facility68.A1, serious: true, causedDeath: true, vaccines: [{ name: vaccineA, batch: 'ALL3' }] });
            await seedBatchCase('ALL2', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineA, batch: 'ALL3' }] });
            await seedBatchCase('ALL3', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineA, batch: 'ALL3' }] });

            await seedBatchCase('VAR', { facility: facility68.A1, vaccines: VARIANT_SPELLINGS.map(( batch ) => ({ name: vaccineB, batch }) ) });

            await seedBatchCase('NOB1', { facility: facility68.A1, vaccines: [{ name: vaccineA, batch: '--' }] });
            await seedBatchCase('NOB2', { facility: facility68.A1 });
            await seedBatchCase('NOB3', { facility: facility68.A1, vaccines: [{ name: vaccineA, batch: null }] });

            await seedBatchCase('NG1', { facility: facility68.A1, serious: true, vaccines: [{ name: vaccineB, batch: 'NOGEO' }] });
            await seedBatchCase('NG2', { facility: facility68.NOGEO, serious: true, vaccines: [{ name: vaccineB, batch: 'NOGEO' }] });

            await seedBatchCase('SPA1', { facility: facility68.A3, vaccines: [{ name: vaccineA, batch: 'SPLIT' }] });
            await seedBatchCase('SPA2', { facility: facility68.A3, vaccines: [{ name: vaccineA, batch: 'SPLIT' }] });
            await seedBatchCase('SPB1', { facility: facility68.B1, vaccines: [{ name: vaccineA, batch: 'SPLIT' }] });
            await seedBatchCase('SPB2', { facility: facility68.B1, vaccines: [{ name: vaccineA, batch: 'SPLIT' }] });

            await seedBatchCase('LIM', {
                facility: facility68.LIM,
                reportDate: '2025-07-15',
                deathDate: '2025-07-15',
                vaccines: Array.from({ length: 55 }, ( _value, index ) => ({ name: vaccineA, batch: `LIM${ `${ index + 1 }`.padStart(2, '0') }` }))
            });

            userAToken68 = ( await createScopedTestUser('dashboard-f68-a', geo68.A) ).token;
        });

        describe('surface and roles', () => {

            it.each(TEST_ROLES)('answers 200 to %s', async ( role ) => {
                const response = await fetchAlerts(authHeader(role));
                expect(response.status).toBe(200);
                expect(response.body.ok).toBe(true);
                expect(typeof response.body.message).toBe('string');
            });

            it('answers 403 AUTH_ROLE_FORBIDDEN without roles and 401 without a token', async () => {
                const forbidden = await fetchAlerts(authHeaderWithoutRole());
                expect(forbidden.status).toBe(403);
                expect(forbidden.body.code).toBe('AUTH_ROLE_FORBIDDEN');
                expect(( await request(app).get(batchAlerts) ).status).toBe(401);
            });

            it('rejects an invalid period with 400', async () => {
                expect(( await fetchAlerts(authHeader('ADMIN'), 'from=2026-05-01&to=2026-04-01') ).status).toBe(400);
            });

            it('carries the period, the scope, the default thresholds and the counters', async () => {
                const data = await userAData();
                expect(data.period).toEqual({ from: '2025-06-01', to: '2025-06-30', days: 30 });
                expect(data.scope).toEqual({ restricted: true, hasAssignments: true, geoLocationId: null });
                expect(data.thresholds).toEqual({ minCases: 3, minSerious: 2 });
                expect(data.total).toBe(6);
                expect(data.batchesEvaluated).toBe(11);
                expect(data.casesWithoutBatch).toBe(3);
            });
        });

        describe('normalization and key', () => {

            it('three spellings of the same batch of the same vaccine form one alert with three variants', async () => {
                const alert = alertOf(await userAData(), keyA, 'AB123');
                expect(alert).toBeDefined();
                expect(alert!.cases).toBe(3);
                expect([...alert!.variants].sort()).toEqual(['AB 123', 'AB.123', 'ab-123'].sort());
                expect(alert!.label).toBe(vaccineA);
                expect(alert!.coded).toBe(false);
            });

            it('the same batch in another vaccine is another batch', async () => {
                const data = await userAData();
                expect(alertOf(data, keyB, 'AB123')).toBeUndefined();
                expect(alertOf(data, keyA, 'AB123')!.cases).toBe(3);
            });

            it('a batch "--" or null forms no batch and its case adds to casesWithoutBatch', async () => {
                const data = await userAData();
                expect(data.alerts.some(( alert: BatchAlertRow ) => alert.batchNumber === '' )).toBe(false);
                expect(data.casesWithoutBatch).toBe(3);
            });

            it('a vaccine with isSuspected false counts in cases and not in suspectedCases', async () => {
                const alert = alertOf(await userAData(), keyA, 'AB123')!;
                expect(alert.cases).toBe(3);
                expect(alert.suspectedCases).toBe(2);
            });

            it('a case with the same batch in two rows counts once', async () => {
                const alert = alertOf(await userAData(), keyA, 'AB123')!;
                expect(alert.cases).toBe(3);
                expect(alert.facilities).toBe(2);
            });
        });

        describe('rule and thresholds', () => {

            it('with the defaults each criterion fires on its own', async () => {
                const data = await userAData();
                expect(alertOf(data, keyA, 'AB123')!.reasons).toEqual(['MIN_CASES']);
                expect(alertOf(data, keyA, 'SER2')!.reasons).toEqual(['MIN_SERIOUS']);
                expect(alertOf(data, keyA, 'DTH1')!.reasons).toEqual(['DEATH']);
            });

            it('a batch with 2 cases, one serious and no death, is no alert but counts in batchesEvaluated', async () => {
                const data = await userAData();
                expect(alertOf(data, keyA, 'ONE1')).toBeUndefined();
                expect(data.batchesEvaluated).toBe(11);
            });

            it('a batch meeting the three criteria carries the three reasons', async () => {
                expect(alertOf(await userAData(), keyA, 'ALL3')!.reasons).toEqual(['MIN_CASES', 'MIN_SERIOUS', 'DEATH']);
            });

            it('ESAVI_DASHBOARD_BATCH_MIN_CASES = 0 disables MIN_CASES and keeps the other criteria', async () => {
                const data = await withBatchConfig({ ESAVI_DASHBOARD_BATCH_MIN_CASES: { value: 0 } }, userAData);
                expect(data.thresholds).toEqual({ minCases: null, minSerious: 2 });
                expect(data.alerts.some(( alert: BatchAlertRow ) => alert.reasons.includes('MIN_CASES') )).toBe(false);
                expect(alertOf(data, keyA, 'AB123')).toBeUndefined();
                expect(alertOf(data, keyA, 'SER2')!.reasons).toEqual(['MIN_SERIOUS']);
                expect(alertOf(data, keyA, 'ALL3')!.reasons).toEqual(['MIN_SERIOUS', 'DEATH']);
            });

            it('a non-integer threshold is rounded up, in the response and in the rule', async () => {
                const data = await withBatchConfig({ ESAVI_DASHBOARD_BATCH_MIN_CASES: { value: 2.4 } }, userAData);
                expect(data.thresholds.minCases).toBe(3);
                expect(alertOf(data, keyA, 'ONE1')).toBeUndefined();
                expect(data.alerts.every(( alert: BatchAlertRow ) => alert.reasons.length > 0 )).toBe(true);
            });

            it('both configurations deactivated without environment variables: 200, defaults applied and two warnings logged', async () => {
                const envCases = process.env.ESAVI_DASHBOARD_BATCH_MIN_CASES;
                const envSerious = process.env.ESAVI_DASHBOARD_BATCH_MIN_SERIOUS;
                delete process.env.ESAVI_DASHBOARD_BATCH_MIN_CASES;
                delete process.env.ESAVI_DASHBOARD_BATCH_MIN_SERIOUS;
                const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;
                try {
                    const response = await withBatchConfig({
                        ESAVI_DASHBOARD_BATCH_MIN_CASES: { isActive: false },
                        ESAVI_DASHBOARD_BATCH_MIN_SERIOUS: { isActive: false }
                    }, () => fetchAlerts(bearer(userAToken68)));
                    expect(response.status).toBe(200);
                    expect(response.body.data.thresholds).toEqual({ minCases: 3, minSerious: 2 });
                    expect(response.body.data.total).toBe(6);
                    await new Promise(( resolve ) => setTimeout(resolve, 200));
                    const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
                    expect(added).toContain('ESAVI-DASH-010 - ESAVI_DASHBOARD_BATCH_MIN_CASES missing or invalid, default 3 applied');
                    expect(added).toContain('ESAVI-DASH-010 - ESAVI_DASHBOARD_BATCH_MIN_SERIOUS missing or invalid, default 2 applied');
                } finally {
                    if( envCases !== undefined ) process.env.ESAVI_DASHBOARD_BATCH_MIN_CASES = envCases;
                    if( envSerious !== undefined ) process.env.ESAVI_DASHBOARD_BATCH_MIN_SERIOUS = envSerious;
                }
            });

            it('a death from any of the three sources fires DEATH with both thresholds disabled', async () => {
                const data = await withBatchConfig({
                    ESAVI_DASHBOARD_BATCH_MIN_CASES: { value: 0 },
                    ESAVI_DASHBOARD_BATCH_MIN_SERIOUS: { value: 0 }
                }, userAData);
                expect(data.thresholds).toEqual({ minCases: null, minSerious: null });
                for( const batch of ['DTH1', 'DTH2', 'DTH3'] ) {
                    expect(alertOf(data, keyA, batch)!.reasons).toEqual(['DEATH']);
                }
                expect(alertOf(data, keyA, 'ALL3')!.reasons).toEqual(['DEATH']);
                expect(data.total).toBe(4);
            });
        });

        describe('metrics', () => {

            it('expiredAtVaccination counts vaccination after expiration, and not a null expiration', async () => {
                const alert = alertOf(await userAData(), keyA, 'AB123')!;
                expect(alert.expiredAtVaccination).toBe(1);
                expect(alert.expirationDates).toEqual(['2025-06-01', '2025-12-31']);
            });

            it('facilities and geoUnits count distinct values, and a facility without geoLocationId adds only to facilities', async () => {
                const alert = alertOf(await alertsOf(authHeader('ADMIN')), keyB, 'NOGEO')!;
                expect(alert.cases).toBe(2);
                expect(alert.facilities).toBe(2);
                expect(alert.geoUnits).toBe(1);
            });

            it('firstReportDate and lastReportDate are the minimum and maximum reportDate of the batch', async () => {
                const alert = alertOf(await userAData(), keyA, 'AB123')!;
                expect(alert.firstReportDate).toBe('2025-06-02');
                expect(alert.lastReportDate).toBe('2025-06-20');
            });

            it('variants holds at most 5 values, in alphabetical order', async () => {
                const data = await withBatchConfig({ ESAVI_DASHBOARD_BATCH_MIN_CASES: { value: 1 } }, userAData);
                const alert = alertOf(data, keyB, 'VAR1')!;
                const rows = await sequelize.query<{ v: string }>(
                    'SELECT v FROM unnest(ARRAY[:spellings]::text[]) v ORDER BY v LIMIT 5',
                    { replacements: { spellings: VARIANT_SPELLINGS }, type: QueryTypes.SELECT }
                );
                expect(alert.variants).toHaveLength(5);
                expect(alert.variants).toEqual(rows.map(( row ) => row.v ));
            });
        });

        describe('order and limit', () => {

            it('an alert with a death and 1 case goes before one with 0 deaths and more cases', async () => {
                const own = ownAlerts(await userAData()).map(( alert ) => alert.batchNumber );
                expect(own[0]).toBe('ALL3');
                expect(own.slice(1, 4)).toEqual(['DTH3', 'DTH2', 'DTH1']);
                expect(own.indexOf('DTH1')).toBeLessThan(own.indexOf('SER2'));
                expect(own.indexOf('SER2')).toBeLessThan(own.indexOf('AB123'));
            });

            it('with 55 batches on alert, alerts carries 50 and total is 55', async () => {
                const data = await alertsOf(authHeader('ADMIN'), `from=2025-07-01&to=2025-07-31&geoLocationId=${ geo68.LIM }`);
                expect(data.total).toBe(55);
                expect(data.alerts).toHaveLength(50);
                expect(data.batchesEvaluated).toBe(55);
            });
        });

        describe('case listing filter', () => {

            it('for the same restricted user and period, the filtered listing count equals each alert cases', async () => {
                for( const alert of ownAlerts(await userAData()) ) {
                    const query = `?batchNumber=${ encodeURIComponent(alert.batchNumber) }&vaccineKey=${ encodeURIComponent(alert.vaccineKey) }&${ listPeriod }`;
                    const list = await request(app).get(`/api/esavi-cases${ query }`).set(bearer(userAToken68));
                    expect(list.status).toBe(200);
                    expect(list.body.data.count).toBe(alert.cases);
                }
            });

            it('an ADMIN gets the same agreement through 002B over the whole country', async () => {
                const alert = alertOf(await countryData(), keyA, 'SPLIT')!;
                const query = `?batchNumber=SPLIT&vaccineKey=${ encodeURIComponent(keyA) }&${ listPeriod }&geoLocationId=${ geo68.X }`;
                const list = await request(app).get(`/api/esavi-cases/admin${ query }`).set(authHeader('ADMIN'));
                expect(list.status).toBe(200);
                expect(list.body.data.count).toBe(alert.cases);
            });
        });

        describe('scope and exposed data', () => {

            it('a batch with 2 cases in A and 2 in B is no alert for a user of A and is one for an ADMIN', async () => {
                const forA = await userAData();
                expect(alertOf(forA, keyA, 'SPLIT')).toBeUndefined();
                expect(alertOf(forA, keyB, 'NOGEO')).toBeUndefined();

                const split = alertOf(await countryData(), keyA, 'SPLIT')!;
                expect(split.cases).toBe(4);
                expect(split.reasons).toEqual(['MIN_CASES']);
                expect(split.facilities).toBe(2);
                expect(split.geoUnits).toBe(2);
            });

            it.each([
                ['a foreign territory', () => geo68.B],
                ['an unknown UUID', () => '00000000-0000-4000-8000-000000000068']
            ])('with geoLocationId of %s: 200, no alerts and zero counters', async ( _label, target ) => {
                const response = await fetchAlerts(bearer(userAToken68), `${ batchPeriod }&geoLocationId=${ target() }`);
                expect(response.status).toBe(200);
                expect(response.body.data.alerts).toEqual([]);
                expect(response.body.data.total).toBe(0);
                expect(response.body.data.batchesEvaluated).toBe(0);
                expect(response.body.data.casesWithoutBatch).toBe(0);
                expect(response.body.data.thresholds).toEqual({ minCases: 3, minSerious: 2 });
            });

            it('a foreign territory and an unknown UUID produce identical responses', async () => {
                const strip = ( data: { scope: Record<string, unknown> } ) => ({ ...data, scope: { ...data.scope, geoLocationId: null } });
                const foreign = ( await fetchAlerts(bearer(userAToken68), `${ batchPeriod }&geoLocationId=${ geo68.B }`) ).body.data;
                const unknown = ( await fetchAlerts(bearer(userAToken68), `${ batchPeriod }&geoLocationId=00000000-0000-4000-8000-000000000068`) ).body.data;
                expect(strip(foreign)).toEqual(strip(unknown));
            });

            it('the response carries no case or patient identifier at any level', async () => {
                const keys = keysOf(( await fetchAlerts(authHeader('SUPERADMIN')) ).body);
                for( const forbidden of ['caseId', 'caseCode', 'patientId', 'names', 'lastNames', 'documentNumber', 'healthSystemCode'] ) {
                    expect(keys.has(forbidden)).toBe(false);
                }
            });
        });

        describe('no writes', () => {

            it('calling ESAVI-DASH-010 and the filtered listing leaves updatedAt, appDetails and sysDetails untouched', async () => {
                const caseIds = Object.values(batchIds);
                const notificationIds = ( await Notification.findAll({ where: { caseId: caseIds }, attributes: ['notificationId'] }) )
                    .map(( row ) => row.getDataValue('notificationId') );
                const attributes = ['updatedAt', 'appDetails', 'sysDetails'];
                const snapshot = async () => JSON.stringify(await Promise.all([
                    EsaviCase.findAll({ where: { caseId: caseIds }, attributes: ['caseId', ...attributes], order: [['caseId', 'ASC']] }),
                    CaseWorkflow.findAll({ where: { caseId: caseIds }, attributes: ['caseId', ...attributes], order: [['caseId', 'ASC']] }),
                    Notification.findAll({ where: { caseId: caseIds }, attributes: ['notificationId', ...attributes], order: [['notificationId', 'ASC']] }),
                    NotificationVaccine.findAll({ where: { notificationId: notificationIds }, attributes: ['vaccineId', ...attributes], order: [['vaccineId', 'ASC']] })
                ]));
                const before = await snapshot();
                expect(( await fetchAlerts(bearer(userAToken68)) ).status).toBe(200);
                expect(( await fetchAlerts(authHeader('ADMIN')) ).status).toBe(200);
                const list = await request(app).get(`/api/esavi-cases?batchNumber=AB123&vaccineKey=${ encodeURIComponent(keyA) }&${ listPeriod }`).set(bearer(userAToken68));
                expect(list.status).toBe(200);
                expect(await snapshot()).toBe(before);
            });
        });
    });
});
