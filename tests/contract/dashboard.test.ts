import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import { CaseWorkflow, EsaviCase, GeoLevelType, GeoLocation, HealthFacility, Notification, Patient, SystemConfig } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { advanceCaseWorkflowStageService } from '../../src/services/caseWorkflow.service';
import { CASE_WORKFLOW_STATUS } from '../../src/constants/caseWorkflow.constants';
import { closeTestDatabase, seedCaseWorkflow, setCaseWorkflowStatus } from '../setup/database';
import { seedTestUsers, authHeader, createScopedTestUser } from '../setup/auth';
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
});
