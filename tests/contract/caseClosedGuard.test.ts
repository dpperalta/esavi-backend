import request from 'supertest';
import { Classification, EsaviCase, FinalClassification, HealthFacility, Investigation, Notification, Patient } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { getMessage } from '../../src/helpers';
import { closeTestDatabase, seedCaseWorkflow, setCaseWorkflowStatus } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for SPEC F61: a case whose workflow is CLOSED accepts no write over its content.
 *
 * `CLOSED_GUARD_RULES` lists, route by route, every write the guard covers. Each row is walked on
 * a fresh case that is closed straight on the workflow row — `ESAVI-CASEFLOW-008` has
 * preconditions this suite has no reason to build — and checks the five things the spec promises:
 * the 409 with its own code, that nothing was written, that the same request answers as before
 * once `ESAVI-CASEFLOW-009` reopens the case, that `PENDING_VALIDATION` and a missing workflow do
 * not block, and that an id that does not exist is still a 404.
 *
 * A route joins the guard by adding one row here and, if its family is new, one entry to
 * `FAMILIES`. The paths carry the `UUID` placeholder of `ROUTE_RULES`, replaced by the real id.
 */

type Method = 'put' | 'delete' | 'patch' | 'post';

interface ClosedGuardRule {
    method: Method;
    path: string;
    code: string;
}

const UUID = '00000000-0000-4000-8000-000000000000';

const CLOSED_GUARD_RULES: ClosedGuardRule[] = [
    // classification (SPEC F09). The 001 is covered by CASEFLOW_012, not by this matrix
    { method: 'put',    path: `/api/classifications/${ UUID }`,          code: 'ESAVI-CLASSIF-004' },
    { method: 'delete', path: `/api/classifications/${ UUID }`,          code: 'ESAVI-CLASSIF-005A' },
    { method: 'patch',  path: `/api/classifications/activate/${ UUID }`, code: 'ESAVI-CLASSIF-005B' },

    // notification (SPEC F10)
    { method: 'put',    path: `/api/notifications/${ UUID }`,            code: 'ESAVI-NOTIFCN-004' },
    { method: 'delete', path: `/api/notifications/${ UUID }`,            code: 'ESAVI-NOTIFCN-005A' },
    { method: 'patch',  path: `/api/notifications/activate/${ UUID }`,   code: 'ESAVI-NOTIFCN-005B' },

    // investigation (SPEC F28)
    { method: 'put',    path: `/api/investigations/${ UUID }`,           code: 'ESAVI-INVESTGN-004' },
    { method: 'delete', path: `/api/investigations/${ UUID }`,           code: 'ESAVI-INVESTGN-005A' },
    { method: 'patch',  path: `/api/investigations/activate/${ UUID }`,  code: 'ESAVI-INVESTGN-005B' },

    // final classification (SPEC F41)
    { method: 'put',    path: `/api/final-classifications/${ UUID }`,          code: 'ESAVI-FINCLASS-004' },
    { method: 'delete', path: `/api/final-classifications/${ UUID }`,          code: 'ESAVI-FINCLASS-005A' },
    { method: 'patch',  path: `/api/final-classifications/activate/${ UUID }`, code: 'ESAVI-FINCLASS-005B' }
];

// The role that reaches each operation: 004 is USER, the retirement is ADMIN and the return
// SUPERADMIN, as ROUTE_RULES declares
const ROLE_BY_OP: Record<string, TestRole> = {
    '004': 'USER',
    '005A': 'ADMIN',
    '005B': 'SUPERADMIN'
};

interface Prepared {
    caseId: string;
    rowId: string;
}

interface Family {
    // The base path of the entity, used by the reads and the purge
    basePath: string;
    // Creates the row straight on the model, over the case, with the requested activity
    create: ( caseId: string, isActive: boolean ) => Promise<string>;
    // Reads it back whole, to compare what a rejected write must not have touched
    read: ( rowId: string ) => Promise<Record<string, unknown>>;
    // A body for the 004 that really changes a field
    changingBody: Record<string, unknown>;
    // A valid 001 body, for the families whose 001 already answered CASEFLOW_012
    createBody?: ( caseId: string ) => Record<string, unknown>;
}

const FAMILIES: Record<string, Family> = {
    CLASSIF: {
        basePath: '/api/classifications',
        create: async ( caseId, isActive ) =>
            ( await Classification.create({ caseId, isSeriousEvent: false, isActive }) ).getDataValue('classificationId'),
        read: async rowId => ( await Classification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId, isSeriousEvent: false })
    },
    NOTIFCN: {
        basePath: '/api/notifications',
        create: async ( caseId, isActive ) =>
            ( await Notification.create({
                caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose', isActive
            }) ).getDataValue('notificationId'),
        read: async rowId => ( await Notification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { esaviDescription: 'Closed guard probe' },
        createBody: caseId => ({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fever after the dose' })
    },
    INVESTGN: {
        basePath: '/api/investigations',
        create: async ( caseId, isActive ) =>
            ( await Investigation.create({ caseId, isActive }) ).getDataValue('investigationId'),
        read: async rowId => ( await Investigation.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId })
    },
    FINCLASS: {
        basePath: '/api/final-classifications',
        create: async ( caseId, isActive ) =>
            ( await FinalClassification.create({ caseId, isActive }) ).getDataValue('finalClassificationId'),
        read: async rowId => ( await FinalClassification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId })
    }
};

const prefixOf = ( code: string ): string => code.split('-')[1];
const opOf = ( code: string ): string => code.split('-')[2];

describe('case closed guard contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // errorHandler logs every error it handles, and most of these tests trigger errors on
    // purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // Every case is minted fresh: the phase headers are one to one, so two tests cannot share one.
    // `withWorkflow: false` builds the case as one created before SPEC F44, with no workflow row
    const createCaseFixture = async ( options: { withWorkflow?: boolean } = {} ): Promise<string> => {
        const { withWorkflow = true } = options;
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`ClosedGuard ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CG${ caseCounter }${ suffix }`),
            healthSystemCode: `CG${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `CG${ caseCounter }${ suffix }`,
            name: `Closed Guard ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `CG-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04'
        });
        const caseId = esaviCase.getDataValue('caseId');
        if( withWorkflow ) {
            await seedCaseWorkflow(caseId);
        }
        return caseId;
    };

    // A row of the family over a fresh case. A 005B needs the row retired first, so the activity
    // is decided by the operation under test
    const prepare = async (
        code: string,
        options: { withWorkflow?: boolean } = {}
    ): Promise<Prepared> => {
        const caseId = await createCaseFixture(options);
        const rowId = await FAMILIES[prefixOf(code)].create(caseId, opOf(code) !== '005B');
        return { caseId, rowId };
    };

    const send = ( rule: ClosedGuardRule, rowId: string, query: string = '' ) => {
        const family = FAMILIES[prefixOf(rule.code)];
        const op = opOf(rule.code);
        const url = rule.path.replace(UUID, rowId) + query;
        const call = request(app)[rule.method](url).set(authHeader(ROLE_BY_OP[op]));
        return op === '004' ? call.send(family.changingBody) : call;
    };

    const reopen = ( caseId: string ) =>
        request(app).patch(`/api/case-workflows/case/${ caseId }/reopen`).set(authHeader('ADMIN'));

    // What a rejected write must not have moved
    const snapshotOf = ( row: Record<string, unknown> ) => ({
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        updatedAt: row.updatedAt ? new Date(row.updatedAt as string).getTime() : null,
        version: ( row.sysDetails as { version?: number } | null )?.version ?? null,
        appDetailsLength: Array.isArray(row.appDetails) ? row.appDetails.length : 0
    });

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe.each(CLOSED_GUARD_RULES)('$code — $method $path', rule => {
        const prefix = prefixOf(rule.code);
        const op = opOf(rule.code);
        const expectedCode = `${ prefix }_${ op }_CASE_CLOSED`;
        const family = FAMILIES[prefix];

        it(`answers 409 ${ expectedCode } on a closed case and writes nothing`, async () => {
            const { caseId, rowId } = await prepare(rule.code);
            const before = snapshotOf(await family.read(rowId));
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            const response = await send(rule, rowId);

            expect(response.status).toBe(409);
            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe(expectedCode);
            expect(response.body.message).toBe(getMessage('caseWorkflow.caseClosed', 'es'));
            expect(snapshotOf(await family.read(rowId))).toEqual(before);
        });

        it('answers the message of the request language', async () => {
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            const response = await send(rule, rowId, '?lang=en');

            expect(response.status).toBe(409);
            expect(response.body.message).toBe(getMessage('caseWorkflow.caseClosed', 'en'));
        });

        it('answers as before once ESAVI-CASEFLOW-009 reopens the case', async () => {
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'CLOSED');
            expect(( await send(rule, rowId) ).status).toBe(409);

            expect(( await reopen(caseId) ).status).toBe(200);

            expect(( await send(rule, rowId) ).status).toBe(200);
        });

        it('does not block a case in PENDING_VALIDATION', async () => {
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'PENDING_VALIDATION');

            expect(( await send(rule, rowId) ).status).toBe(200);
        });

        it('does not block a case with no workflow row', async () => {
            const { rowId } = await prepare(rule.code, { withWorkflow: false });

            expect(( await send(rule, rowId) ).status).toBe(200);
        });

        it('answers 404 and not 409 for an id that does not exist', async () => {
            const response = await send(rule, UUID);

            expect(response.status).toBe(404);
        });
    });

    describe('the 004 answers 409 whatever the body carries', () => {
        const updates = CLOSED_GUARD_RULES.filter(rule => opOf(rule.code) === '004');

        it.each(updates)('$code with an empty body on a closed case', async rule => {
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            const response = await request(app)
                .put(rule.path.replace(UUID, rowId))
                .set(authHeader('USER'))
                .send({});

            expect(response.status).toBe(409);
            expect(response.body.code).toBe(`${ prefixOf(rule.code) }_004_CASE_CLOSED`);
        });
    });

    describe('a rejected retirement or return leaves the row as it was', () => {
        it.each(['CLASSIF', 'NOTIFCN', 'INVESTGN', 'FINCLASS'])('%s keeps isActive after a rejected 005A', async key => {
            const rule = CLOSED_GUARD_RULES.find(r => r.code === `ESAVI-${ key }-005A`)!;
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            expect(( await send(rule, rowId) ).status).toBe(409);

            expect(( await FAMILIES[key].read(rowId) ).isActive).toBe(true);
        });

        it.each(['CLASSIF', 'NOTIFCN', 'INVESTGN', 'FINCLASS'])('%s keeps isActive false after a rejected 005B', async key => {
            const rule = CLOSED_GUARD_RULES.find(r => r.code === `ESAVI-${ key }-005B`)!;
            const { caseId, rowId } = await prepare(rule.code);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            expect(( await send(rule, rowId) ).status).toBe(409);

            expect(( await FAMILIES[key].read(rowId) ).isActive).toBe(false);
        });
    });

    describe('outside the guard', () => {
        const keys = Object.keys(FAMILIES);

        it.each(keys)('%s 001 on a closed case still answers CASEFLOW_012_CASE_CLOSED', async key => {
            const caseId = await createCaseFixture();
            await setCaseWorkflowStatus(caseId, 'CLOSED');
            const family = FAMILIES[key];

            const response = await request(app)
                .post(family.basePath)
                .set(authHeader('USER'))
                .send(family.createBody!(caseId));

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CASEFLOW_012_CASE_CLOSED');
        });

        it.each(keys)('%s is readable on a closed case', async key => {
            const family = FAMILIES[key];
            const caseId = await createCaseFixture();
            const rowId = await family.create(caseId, true);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            const byId = await request(app).get(`${ family.basePath }/${ rowId }`).set(authHeader('USER'));
            const list = await request(app).get(family.basePath).set(authHeader('USER'));

            expect(byId.status).toBe(200);
            expect(list.status).toBe(200);
        });

        it.each(keys)('%s 005C purges a retired row of a closed case', async key => {
            const family = FAMILIES[key];
            const caseId = await createCaseFixture();
            const rowId = await family.create(caseId, false);
            await setCaseWorkflowStatus(caseId, 'CLOSED');

            const response = await request(app)
                .delete(`${ family.basePath }/purge/${ rowId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
        });
    });
});
