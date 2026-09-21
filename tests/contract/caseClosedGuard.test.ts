import request from 'supertest';
import {
    CatalogItem, CatalogType, Classification, DiagnosticTerm, EsaviCase, FinalClassification, HealthFacility,
    Investigation, NonSevereNotification, Notification, NotificationEvent, NotificationMedicalHistory,
    NotificationMedication, NotificationPregnancy, NotificationVaccine, Notifier, Patient, SevereNotification,
    SystemConfig
} from '../../src/models';
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
    // esaviCase (SPEC F06). Only the 004: the 001 creates the case, and the 005A and 005B act on the
    // life cycle of the whole case and not on its content
    { method: 'put',    path: `/api/esavi-cases/${ UUID }`,              code: 'ESAVI-CASE-004' },

    // notifier (SPEC F07)
    { method: 'post',   path: '/api/notifiers',                          code: 'ESAVI-NOTIFIER-001' },
    { method: 'put',    path: `/api/notifiers/${ UUID }`,                code: 'ESAVI-NOTIFIER-004' },
    { method: 'delete', path: `/api/notifiers/${ UUID }`,                code: 'ESAVI-NOTIFIER-005A' },
    { method: 'patch',  path: `/api/notifiers/activate/${ UUID }`,       code: 'ESAVI-NOTIFIER-005B' },

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

    // paso 4, one to one details of the notification. No 005A or 005B: their tables have no isActive
    { method: 'post',   path: '/api/severe-notifications',                    code: 'ESAVI-SEVNOT-001' },
    { method: 'put',    path: `/api/severe-notifications/${ UUID }`,          code: 'ESAVI-SEVNOT-004' },
    { method: 'post',   path: '/api/non-severe-notifications',                code: 'ESAVI-NSEVNOT-001' },
    { method: 'put',    path: `/api/non-severe-notifications/${ UUID }`,      code: 'ESAVI-NSEVNOT-004' },

    // paso 4, collections of the notification (SPEC F16, F21, F22, F25 and F57) and its pregnancy
    { method: 'post',   path: '/api/notification-events',                                code: 'ESAVI-NOTIFEVT-001' },
    { method: 'put',    path: `/api/notification-events/${ UUID }`,                      code: 'ESAVI-NOTIFEVT-004' },
    { method: 'delete', path: `/api/notification-events/${ UUID }`,                      code: 'ESAVI-NOTIFEVT-005A' },
    { method: 'patch',  path: `/api/notification-events/activate/${ UUID }`,             code: 'ESAVI-NOTIFEVT-005B' },
    { method: 'post',   path: '/api/notification-medications',                           code: 'ESAVI-NOTIFMED-001' },
    { method: 'put',    path: `/api/notification-medications/${ UUID }`,                 code: 'ESAVI-NOTIFMED-004' },
    { method: 'delete', path: `/api/notification-medications/${ UUID }`,                 code: 'ESAVI-NOTIFMED-005A' },
    { method: 'patch',  path: `/api/notification-medications/activate/${ UUID }`,        code: 'ESAVI-NOTIFMED-005B' },
    { method: 'post',   path: '/api/notification-vaccines',                              code: 'ESAVI-NOTIFVAC-001' },
    { method: 'put',    path: `/api/notification-vaccines/${ UUID }`,                    code: 'ESAVI-NOTIFVAC-004' },
    { method: 'delete', path: `/api/notification-vaccines/${ UUID }`,                    code: 'ESAVI-NOTIFVAC-005A' },
    { method: 'patch',  path: `/api/notification-vaccines/activate/${ UUID }`,           code: 'ESAVI-NOTIFVAC-005B' },
    { method: 'post',   path: '/api/notification-pregnancies',                           code: 'ESAVI-NOTIFPRG-001' },
    { method: 'put',    path: `/api/notification-pregnancies/${ UUID }`,                 code: 'ESAVI-NOTIFPRG-004' },
    { method: 'delete', path: `/api/notification-pregnancies/${ UUID }`,                 code: 'ESAVI-NOTIFPRG-005A' },
    { method: 'patch',  path: `/api/notification-pregnancies/activate/${ UUID }`,        code: 'ESAVI-NOTIFPRG-005B' },
    { method: 'post',   path: '/api/notification-medical-histories',                     code: 'ESAVI-MEDHIST-001' },
    { method: 'put',    path: `/api/notification-medical-histories/${ UUID }`,           code: 'ESAVI-MEDHIST-004' },
    { method: 'delete', path: `/api/notification-medical-histories/${ UUID }`,           code: 'ESAVI-MEDHIST-005A' },
    { method: 'patch',  path: `/api/notification-medical-histories/activate/${ UUID }`,  code: 'ESAVI-MEDHIST-005B' },

    // final classification (SPEC F41)
    { method: 'put',    path: `/api/final-classifications/${ UUID }`,          code: 'ESAVI-FINCLASS-004' },
    { method: 'delete', path: `/api/final-classifications/${ UUID }`,          code: 'ESAVI-FINCLASS-005A' },
    { method: 'patch',  path: `/api/final-classifications/activate/${ UUID }`, code: 'ESAVI-FINCLASS-005B' }
];

// The role that reaches each operation: 004 is USER, the retirement is ADMIN and the return
// SUPERADMIN, as ROUTE_RULES declares
const ROLE_BY_OP: Record<string, TestRole> = {
    '001': 'USER',
    '004': 'USER',
    '005A': 'ADMIN',
    '005B': 'SUPERADMIN'
};

interface Prepared {
    caseId: string;
    rowId: string;
    // The notification the row hangs from, for the satellites; empty for the rest
    parentId: string;
}

interface Family {
    // The base path of the entity, used by the reads and the purge
    basePath: string;
    // True for the four phase headers, whose 001 is covered by CASEFLOW_012 and not by the matrix
    isPhase?: boolean;
    // True for the entities with no 005C: the case is retired by its own 005A and never purged
    hasNoPurge?: boolean;
    // Roles that differ from ROLE_BY_OP: a case whose facility has no geoLocation is visible to an
    // ADMIN only, which is what F49 makes of the cases this suite builds
    roles?: Partial<Record<string, TestRole>>;
    // How many rows the case or its parent holds, for the families whose guarded operation is a 001
    countRows?: ( caseId: string, parentId: string ) => Promise<number>;
    // The list read of the entity, when it is not the base path itself
    listPath?: ( target: Prepared ) => string;
    // True when the rule of the family needs a female patient on the case: the pregnancy
    needsFemalePatient?: boolean;
    // Creates the notification a satellite hangs from, over the case
    createParent?: ( caseId: string ) => Promise<string>;
    // Creates the row straight on the model, over the case, with the requested activity
    create: ( caseId: string, isActive: boolean, parentId: string ) => Promise<string>;
    // Reads it back whole, to compare what a rejected write must not have touched
    read: ( rowId: string ) => Promise<Record<string, unknown>>;
    // A body for the 004 that really changes a field
    changingBody: Record<string, unknown>;
    // A valid 001 body: for the phase headers it is the request that already answered CASEFLOW_012
    createBody?: ( caseId: string, parentId: string ) => Record<string, unknown>;
}

const runTag = Date.now().toString(36).toUpperCase();
let termCounter = 0;

const notificationOf = async ( caseId: string, notificationType: 'SEVERE' | 'NON_SEVERE' ): Promise<string> =>
    ( await Notification.create({ caseId, notificationType, esaviDescription: 'Fever after the dose' }) )
        .getDataValue('notificationId');

const createNonSevereParent = ( caseId: string ) => notificationOf(caseId, 'NON_SEVERE');

// The collections keep their sortOrder for the trigger of the table to assign, so the column is
// left out of the INSERT: listing the fields is what makes it absent from the statement
const insertOmittingSortOrder = <T extends Record<string, unknown>>( values: T ): { fields: never } =>
    ({ fields: Object.keys(values) as never });

const FAMILIES: Record<string, Family> = {
    SEVNOT: {
        basePath: '/api/severe-notifications',
        countRows: ( _caseId, parentId ) => SevereNotification.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/severe-notifications/case/${ target.caseId }`,
        createParent: caseId => notificationOf(caseId, 'SEVERE'),
        // The primary key of the detail IS the notificationId. A retired detail carries the seal of
        // deletedAt, which is what its purge asks for: the table has no isActive
        create: async ( _caseId, isActive, parentId ) => {
            await SevereNotification.create({ notificationId: parentId, ...( isActive ? {} : { deletedAt: new Date() } ) });
            return parentId;
        },
        read: async rowId => ( await SevereNotification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId })
    },
    NSEVNOT: {
        basePath: '/api/non-severe-notifications',
        countRows: ( _caseId, parentId ) => NonSevereNotification.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/non-severe-notifications/case/${ target.caseId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) => {
            await NonSevereNotification.create({ notificationId: parentId, ...( isActive ? {} : { deletedAt: new Date() } ) });
            return parentId;
        },
        read: async rowId => ( await NonSevereNotification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId })
    },
    NOTIFEVT: {
        basePath: '/api/notification-events',
        countRows: ( _caseId, parentId ) => NotificationEvent.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/notification-events/notification/${ target.parentId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) => {
            const values = { notificationId: parentId, esaviName: 'Fiebre', isActive };
            return ( await NotificationEvent.create(values, insertOmittingSortOrder(values)) ).getDataValue('eventId');
        },
        read: async rowId => ( await NotificationEvent.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId, esaviName: 'Fiebre' })
    },
    NOTIFMED: {
        basePath: '/api/notification-medications',
        countRows: ( _caseId, parentId ) => NotificationMedication.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/notification-medications/notification/${ target.parentId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) => {
            const values = { notificationId: parentId, medicationName: 'Ibuprofeno', isActive };
            return ( await NotificationMedication.create(values, insertOmittingSortOrder(values)) ).getDataValue('medicationId');
        },
        read: async rowId => ( await NotificationMedication.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { dose: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId, medicationName: 'Ibuprofeno' })
    },
    NOTIFVAC: {
        basePath: '/api/notification-vaccines',
        countRows: ( _caseId, parentId ) => NotificationVaccine.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/notification-vaccines/notification/${ target.parentId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) => {
            const values = { notificationId: parentId, vaccineName: 'BCG', isActive };
            return ( await NotificationVaccine.create(values, insertOmittingSortOrder(values)) ).getDataValue('vaccineId');
        },
        read: async rowId => ( await NotificationVaccine.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId, vaccineName: 'BCG' })
    },
    NOTIFPRG: {
        basePath: '/api/notification-pregnancies',
        needsFemalePatient: true,
        countRows: ( _caseId, parentId ) => NotificationPregnancy.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/notification-pregnancies/notification/${ target.parentId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) =>
            ( await NotificationPregnancy.create({
                notificationId: parentId, wasPregnantAtVaccination: 'YES', isActive
            }) ).getDataValue('pregnancyId'),
        read: async rowId => ( await NotificationPregnancy.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId, wasPregnantAtVaccination: 'YES' })
    },
    MEDHIST: {
        basePath: '/api/notification-medical-histories',
        countRows: ( _caseId, parentId ) => NotificationMedicalHistory.count({ where: { notificationId: parentId } }),
        listPath: target => `/api/notification-medical-histories/notification/${ target.parentId }`,
        createParent: createNonSevereParent,
        create: async ( _caseId, isActive, parentId ) => {
            termCounter += 1;
            const term = await DiagnosticTerm.create({
                source: 'LOCAL', code: `CG${ runTag }${ termCounter }`, name: `Asma ${ runTag } ${ termCounter }`
            });
            const values = { notificationId: parentId, diagnosticTermId: term.getDataValue('diagnosticTermId'), isActive };
            return ( await NotificationMedicalHistory.create(values, insertOmittingSortOrder(values)) )
                .getDataValue('medicalHistoryId');
        },
        read: async rowId => ( await NotificationMedicalHistory.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: ( _caseId, parentId ) => ({ notificationId: parentId, historyName: 'Asma' })
    },
    CASE: {
        basePath: '/api/esavi-cases',
        hasNoPurge: true,
        roles: { '004': 'ADMIN' },
        // The row of this family IS the case
        create: async ( caseId, isActive ) => {
            if( !isActive ) {
                await EsaviCase.update({ isActive: false }, { where: { caseId } });
            }
            return caseId;
        },
        read: async rowId => ( await EsaviCase.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { details: 'Closed guard probe' }
    },
    NOTIFIER: {
        basePath: '/api/notifiers',
        create: async ( caseId, isActive ) =>
            ( await Notifier.create({
                caseId, firstName: esaviCrypt('Ana'), lastName: esaviCrypt('Perez'), isActive
            }) ).getDataValue('notifierId'),
        read: async rowId => ( await Notifier.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        countRows: caseId => Notifier.count({ where: { caseId } }),
        changingBody: { room: 'Closed guard probe' },
        createBody: caseId => ({ caseId, firstName: 'Ana', lastName: 'Perez' })
    },
    CLASSIF: {
        basePath: '/api/classifications',
        isPhase: true,
        create: async ( caseId, isActive ) =>
            ( await Classification.create({ caseId, isSeriousEvent: false, isActive }) ).getDataValue('classificationId'),
        read: async rowId => ( await Classification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId, isSeriousEvent: false })
    },
    NOTIFCN: {
        basePath: '/api/notifications',
        isPhase: true,
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
        isPhase: true,
        create: async ( caseId, isActive ) =>
            ( await Investigation.create({ caseId, isActive }) ).getDataValue('investigationId'),
        read: async rowId => ( await Investigation.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId })
    },
    FINCLASS: {
        basePath: '/api/final-classifications',
        isPhase: true,
        create: async ( caseId, isActive ) =>
            ( await FinalClassification.create({ caseId, isActive }) ).getDataValue('finalClassificationId'),
        read: async rowId => ( await FinalClassification.findByPk(rowId, { raw: true }) ) as Record<string, unknown>,
        changingBody: { notes: 'Closed guard probe' },
        createBody: caseId => ({ caseId })
    }
};

const roleOf = ( rule: ClosedGuardRule ): TestRole => {
    const [ , prefix, op ] = rule.code.split('-');
    return FAMILIES[prefix].roles?.[op] ?? ROLE_BY_OP[op];
};

// What a request that succeeds answers: a 001 creates
const successStatusOf = ( rule: ClosedGuardRule ): number => rule.method === 'post' ? 201 : 200;

const prefixOf = ( code: string ): string => code.split('-')[1];
const opOf = ( code: string ): string => code.split('-')[2];

describe('case closed guard contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // errorHandler logs every error it handles, and most of these tests trigger errors on
    // purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    // The pregnancy is the one rule of paso 4 that reads the patient: its 001 needs the sex item the
    // configuration names, and a case whose patient carries it
    let femaleItemId: string;

    // Every case is minted fresh: the phase headers are one to one, so two tests cannot share one.
    // `withWorkflow: false` builds the case as one created before SPEC F44, with no workflow row
    const createCaseFixture = async ( options: { withWorkflow?: boolean, female?: boolean } = {} ): Promise<string> => {
        const { withWorkflow = true, female = false } = options;
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`ClosedGuard ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CG${ caseCounter }${ suffix }`),
            healthSystemCode: `CG${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04',
            sexItemId: female ? femaleItemId : null
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
            // No eventDate on purpose: the suite mints a case per test, and a dated one would crowd the
            // first page of the eventDate range filters of esaviCase.test.ts, which read a shared table
            eventDate: null
        });
        const caseId = esaviCase.getDataValue('caseId');
        if( withWorkflow ) {
            await seedCaseWorkflow(caseId);
        }
        return caseId;
    };

    // The row of the family over a fresh case, with its parent when it has one. A 005B needs the row
    // retired first, so the activity is decided by the operation under test. A 001 creates its row, so
    // it starts without one
    const prepare = async (
        code: string,
        options: { withWorkflow?: boolean } = {}
    ): Promise<Prepared> => {
        const family = FAMILIES[prefixOf(code)];
        const caseId = await createCaseFixture({ ...options, female: family.needsFemalePatient });
        const parentId = family.createParent ? await family.createParent(caseId) : '';
        const rowId = opOf(code) === '001' ? '' : await family.create(caseId, opOf(code) !== '005B', parentId);
        return { caseId, rowId, parentId };
    };

    // `target.caseId` feeds the body of a 001, `target.rowId` replaces the placeholder of the path
    const send = ( rule: ClosedGuardRule, target: Prepared, query: string = '' ) => {
        const family = FAMILIES[prefixOf(rule.code)];
        const op = opOf(rule.code);
        const url = rule.path.replace(UUID, target.rowId) + query;
        const call = request(app)[rule.method](url).set(authHeader(roleOf(rule)));
        if( op === '001' ) return call.send(family.createBody!(target.caseId, target.parentId));
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

        // The configuration row of the female sex item, created through ESAVI-SYSCONF-001 as
        // notificationPregnancy.test.ts does. Any earlier row is retired by renaming its code: the
        // service reads by (code, scope), and systemConfigHistory does not allow destroying it
        const sexType = await CatalogType.create({ code: `sexCG${ runTag }`, name: `Sex CG ${ runTag }` });
        femaleItemId = ( await CatalogItem.create({
            catalogTypeId: sexType.getDataValue('catalogTypeId'), code: `FCG${ runTag }`, name: 'Femenino', value: '2'
        }) ).getDataValue('catalogItemId');
        await SystemConfig.update({ code: `RETIRED_CG_${ runTag }` }, { where: { code: 'PREGNANCY_FEMALE_SEX_ITEM' } });
        const config = await request(app).post('/api/system-configs').set(authHeader('SUPERADMIN')).send({
            code: 'PREGNANCY_FEMALE_SEX_ITEM',
            name: 'Pregnancy female sex item',
            value: femaleItemId,
            valueType: 'string',
            scope: 'GLOBAL',
            isEncrypted: false
        });
        expect(config.status).toBe(201);
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

        // What a rejected write must not have moved: the row, or the row count for a 001
        const observe = ( target: Prepared ) => op === '001'
            ? family.countRows!(target.caseId, target.parentId)
            : family.read(target.rowId).then(snapshotOf);

        it(`answers 409 ${ expectedCode } on a closed case and writes nothing`, async () => {
            const target = await prepare(rule.code);
            const before = await observe(target);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            const response = await send(rule, target);

            expect(response.status).toBe(409);
            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe(expectedCode);
            expect(response.body.message).toBe(getMessage('caseWorkflow.caseClosed', 'es'));
            expect(await observe(target)).toEqual(before);
        });

        it('answers the message of the request language', async () => {
            const target = await prepare(rule.code);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            const response = await send(rule, target, '?lang=en');

            expect(response.status).toBe(409);
            expect(response.body.message).toBe(getMessage('caseWorkflow.caseClosed', 'en'));
        });

        it('answers as before once ESAVI-CASEFLOW-009 reopens the case', async () => {
            const target = await prepare(rule.code);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');
            expect(( await send(rule, target) ).status).toBe(409);

            expect(( await reopen(target.caseId) ).status).toBe(200);

            expect(( await send(rule, target) ).status).toBe(successStatusOf(rule));
        });

        it('does not block a case in PENDING_VALIDATION', async () => {
            const target = await prepare(rule.code);
            await setCaseWorkflowStatus(target.caseId, 'PENDING_VALIDATION');

            expect(( await send(rule, target) ).status).toBe(successStatusOf(rule));
        });

        it('does not block a case with no workflow row', async () => {
            const target = await prepare(rule.code, { withWorkflow: false });

            expect(( await send(rule, target) ).status).toBe(successStatusOf(rule));
        });

        it('answers 404 and not 409 for a row or a case that does not exist', async () => {
            const response = await send(rule, { rowId: UUID, caseId: UUID, parentId: UUID });

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
                .set(authHeader(roleOf(rule)))
                .send({});

            expect(response.status).toBe(409);
            expect(response.body.code).toBe(`${ prefixOf(rule.code) }_004_CASE_CLOSED`);
        });
    });

    describe('a rejected retirement or return leaves the row as it was', () => {
        const retirements = CLOSED_GUARD_RULES.filter(rule => opOf(rule.code) === '005A');
        const returns = CLOSED_GUARD_RULES.filter(rule => opOf(rule.code) === '005B');

        it.each(retirements)('$code keeps isActive after the rejection', async rule => {
            const target = await prepare(rule.code);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            expect(( await send(rule, target) ).status).toBe(409);

            expect(( await FAMILIES[prefixOf(rule.code)].read(target.rowId) ).isActive).toBe(true);
        });

        it.each(returns)('$code keeps isActive false after the rejection', async rule => {
            const target = await prepare(rule.code);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            expect(( await send(rule, target) ).status).toBe(409);

            expect(( await FAMILIES[prefixOf(rule.code)].read(target.rowId) ).isActive).toBe(false);
        });
    });

    describe('outside the guard', () => {
        const allKeys = Object.keys(FAMILIES);
        const phaseKeys = allKeys.filter(key => FAMILIES[key].isPhase);

        it.each(phaseKeys)('%s 001 on a closed case still answers CASEFLOW_012_CASE_CLOSED', async key => {
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

        it.each(allKeys)('%s is readable on a closed case', async key => {
            const family = FAMILIES[key];
            const target = await prepare(`ESAVI-${ key }-004`);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            const byId = await request(app).get(`${ family.basePath }/${ target.rowId }`).set(authHeader('ADMIN'));
            const list = await request(app)
                .get(family.listPath ? family.listPath(target) : family.basePath)
                .set(authHeader('ADMIN'));

            expect(byId.status).toBe(200);
            expect(list.status).toBe(200);
        });

        it.each(allKeys.filter(key => !FAMILIES[key].hasNoPurge))('%s 005C purges a retired row of a closed case', async key => {
            const family = FAMILIES[key];
            const target = await prepare(`ESAVI-${ key }-005B`);
            await setCaseWorkflowStatus(target.caseId, 'CLOSED');

            const response = await request(app)
                .delete(`${ family.basePath }/purge/${ target.rowId }`)
                .set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(200);
        });
    });
});
