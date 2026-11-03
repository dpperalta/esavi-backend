import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import {
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
    InvestigationAutopsy,
    Notification,
    Patient,
    SystemConfig
} from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { advanceCaseWorkflowStageService } from '../../src/services/caseWorkflow.service';
import { CASE_WORKFLOW_STATUS } from '../../src/constants/caseWorkflow.constants';
import { closeTestDatabase, seedCaseWorkflow, setCaseWorkflowStatus } from '../setup/database';
import { TEST_ROLES, seedTestUsers, seedUserWithoutRole, authHeader, authHeaderWithoutRole, createScopedTestUser } from '../setup/auth';
import type { TestRole } from '../setup/auth';

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
});
