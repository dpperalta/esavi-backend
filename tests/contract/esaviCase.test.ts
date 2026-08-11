import request from 'supertest';
import { app } from '../../src/app';
import { Classification, EsaviCase, HealthFacility, Notifier, Patient } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the seven esaviCase operations of SPEC F06. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the
 * caseCode minted from the registration date and never handed to the client, the
 * sequence that restarts per facility and day without ever reusing a released
 * code, the two mandatory foreign keys that no database trigger validates, and
 * the date coherence that 004 checks against the resulting state.
 */
describe('esaviCase contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    // Fixtures shared by the whole file. Cases need a patient and a facility, and
    // the facility needs a localCode or no code can be minted
    let patientId: string;
    let otherPatientId: string;
    let inactivePatientId: string;
    let facilityId: string;
    let otherFacilityId: string;
    let noLocalCodeFacilityId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    const isoDate = ( offsetDays: number ): string => {
        const date = new Date();
        date.setDate(date.getDate() + offsetDays);
        return `${ date.getFullYear() }-${ `${ date.getMonth() + 1 }`.padStart(2, '0') }-${ `${ date.getDate() }`.padStart(2, '0') }`;
    };

    // The DDMMYYYY stamp the codes minted during this run must carry
    const todayStamp = (): string => {
        const today = isoDate(0);
        return `${ today.slice(8, 10) }${ today.slice(5, 7) }${ today.slice(0, 4) }`;
    };

    const createCase = ( payload: Record<string, unknown> = {}, role: TestRole = 'USER' ) =>
        request(app)
            .post('/api/esavi-cases')
            .set(authHeader(role))
            .send({ patientId, healthFacilityId: facilityId, ...payload });

    const getCase = ( id: string, role: TestRole = 'USER' ) =>
        request(app).get(`/api/esavi-cases/${ id }`).set(authHeader(role));

    const listCases = ( query: string = '', role: TestRole = 'USER' ) =>
        request(app).get(`/api/esavi-cases${ query }`).set(authHeader(role));

    const listAdminCases = ( query: string = '', role: TestRole = 'ADMIN' ) =>
        request(app).get(`/api/esavi-cases/admin${ query }`).set(authHeader(role));

    const updateCase = ( id: string, payload: Record<string, unknown>, role: TestRole = 'USER' ) =>
        request(app).put(`/api/esavi-cases/${ id }`).set(authHeader(role)).send(payload);

    const deleteCase = ( id: string, role: TestRole = 'ADMIN' ) =>
        request(app).delete(`/api/esavi-cases/${ id }`).set(authHeader(role));

    const activateCase = ( id: string, role: TestRole = 'SUPERADMIN' ) =>
        request(app).patch(`/api/esavi-cases/activate/${ id }`).set(authHeader(role));

    const createPatientFixture = async ( label: string, isActive: boolean = true ): Promise<string> => {
        const patient = await Patient.create({
            firstName: esaviCrypt(`Case ${ label }`),
            lastName: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`CS${ label }${ suffix }`),
            healthSystemCode: `CS${ label }${ suffix }`,
            isActive
        });
        return patient.getDataValue('patientId');
    };

    const createFacilityFixture = async ( label: string, withLocalCode: boolean = true ): Promise<string> => {
        const facility = await HealthFacility.create({
            localCode: withLocalCode ? `CS${ label }${ suffix }` : null,
            name: `Case ${ label } ${ suffix }`
        });
        return facility.getDataValue('healthFacilityId');
    };

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();

        patientId = await createPatientFixture('A');
        otherPatientId = await createPatientFixture('B');
        inactivePatientId = await createPatientFixture('C', false);

        facilityId = await createFacilityFixture('A');
        otherFacilityId = await createFacilityFixture('B');
        noLocalCodeFacilityId = await createFacilityFixture('C', false);
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    describe('001 — create', () => {

        it('creates a case and returns the full shape with the patient decrypted', async () => {
            const response = await createCase({
                reportDate: isoDate(-1),
                eventDate: isoDate(-2),
                countryIsoCode: ' ec ',
                reportFillingDate: isoDate(0),
                notificationOrganization: '  ministerio de salud  ',
                details: 'Fiebre posterior a la vacunación'
            });

            expect(response.status).toBe(201);
            expect(response.body.ok).toBe(true);

            const data = response.body.data;
            expect(data.reportDate).toBe(isoDate(-1));
            expect(data.eventDate).toBe(isoDate(-2));
            expect(data.details).toBe('Fiebre posterior a la vacunación');

            // Normalized on write
            expect(data.countryIsoCode).toBe('EC');
            expect(data.notificationOrganization).toBe('Ministerio De Salud');

            // The two relations travel resolved, and the patient in clear text
            expect(data.patient.firstName).toBe('Case A');
            expect(data.patient.documentNumber).toBe(`CSA${ suffix }`);
            expect(data.healthFacility.localCode).toBe(`CSA${ suffix }`);

            // sysDetails never leaves the service, and neither do the raw foreign keys
            expect(data.sysDetails).toBeUndefined();
            expect(data.patientId).toBeUndefined();
            expect(data.healthFacilityId).toBeUndefined();

            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-CASE-001');
        });

        it('stores today when reportDate is absent', async () => {
            const response = await createCase();
            expect(response.body.data.reportDate).toBe(isoDate(0));
        });

        it('rejects a facility without localCode with 409', async () => {
            const response = await createCase({ healthFacilityId: noLocalCodeFacilityId });
            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CASE_001_LOCALCODE_MISSING');
        });

        it('rejects an inactive or unknown patient with 404', async () => {
            const inactive = await createCase({ patientId: inactivePatientId });
            expect(inactive.status).toBe(404);
            expect(inactive.body.code).toBe('CASE_001_PATIENT_NOT_FOUND');

            const unknown = await createCase({ patientId: unknownUuid });
            expect(unknown.status).toBe(404);
            expect(unknown.body.code).toBe('CASE_001_PATIENT_NOT_FOUND');
        });

        it('rejects an unknown facility with 404', async () => {
            const response = await createCase({ healthFacilityId: unknownUuid });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CASE_001_FACILITY_NOT_FOUND');
        });

        it('rejects a missing foreign key with 400', async () => {
            const noPatient = await request(app)
                .post('/api/esavi-cases')
                .set(authHeader('USER'))
                .send({ healthFacilityId: facilityId });
            expect(noPatient.status).toBe(400);

            const noFacility = await request(app)
                .post('/api/esavi-cases')
                .set(authHeader('USER'))
                .send({ patientId });
            expect(noFacility.status).toBe(400);
        });

        it('rejects future and incoherent dates with 400', async () => {
            expect(( await createCase({ reportDate: isoDate(1) }) ).status).toBe(400);
            expect(( await createCase({ eventDate: isoDate(1) }) ).status).toBe(400);
            expect(( await createCase({ reportFillingDate: isoDate(1) }) ).status).toBe(400);

            const eventAfterReport = await createCase({ reportDate: isoDate(-3), eventDate: isoDate(-1) });
            expect(eventAfterReport.status).toBe(400);
        });

    });

    describe('the caseCode', () => {

        it('numbers per facility and registration date, and never reuses a released code', async () => {
            const stamp = todayStamp();
            const facility = await createFacilityFixture('SEQ');

            const first = await createCase({ healthFacilityId: facility });
            expect(first.body.data.caseCode).toBe(`CSSEQ${ suffix }-${ stamp }-0001`);

            const second = await createCase({ healthFacilityId: facility });
            expect(second.body.data.caseCode).toBe(`CSSEQ${ suffix }-${ stamp }-0002`);

            const third = await createCase({ healthFacilityId: facility });
            expect(third.body.data.caseCode).toBe(`CSSEQ${ suffix }-${ stamp }-0003`);

            // Deactivating the third does not put its code back into circulation
            await deleteCase(third.body.data.caseId);
            const fourth = await createCase({ healthFacilityId: facility });
            expect(fourth.body.data.caseCode).toBe(`CSSEQ${ suffix }-${ stamp }-0004`);
        });

        it('restarts at -0001 for a different facility on the same day', async () => {
            const stamp = todayStamp();
            const facility = await createFacilityFixture('RST');

            const response = await createCase({ healthFacilityId: facility });
            expect(response.body.data.caseCode).toBe(`CSRST${ suffix }-${ stamp }-0001`);
        });

        it('mints the code with the registration date, not with reportDate', async () => {
            const stamp = todayStamp();
            const facility = await createFacilityFixture('REG');

            // Reported a week ago, registered today: the code carries today
            const backdated = await createCase({ healthFacilityId: facility, reportDate: isoDate(-7) });
            expect(backdated.body.data.caseCode).toBe(`CSREG${ suffix }-${ stamp }-0001`);
            expect(backdated.body.data.reportDate).toBe(isoDate(-7));

            // And a different reportDate does not restart the sequence
            const next = await createCase({ healthFacilityId: facility, reportDate: isoDate(-2) });
            expect(next.body.data.caseCode).toBe(`CSREG${ suffix }-${ stamp }-0002`);
        });

        it('keeps numbering after a reportDate is corrected through 004', async () => {
            const stamp = todayStamp();
            const facility = await createFacilityFixture('MOV');

            const first = await createCase({ healthFacilityId: facility });
            const second = await createCase({ healthFacilityId: facility });

            const moved = await updateCase(second.body.data.caseId, { reportDate: isoDate(-9) });
            expect(moved.status).toBe(200);
            expect(moved.body.data.caseCode).toBe(second.body.data.caseCode);

            // The sequence is read off the minted prefix, so the moved row is still counted
            const third = await createCase({ healthFacilityId: facility });
            expect(third.body.data.caseCode).toBe(`CSMOV${ suffix }-${ stamp }-0003`);
            expect(first.body.data.caseCode).toBe(`CSMOV${ suffix }-${ stamp }-0001`);
        });

        it('ignores a caseCode sent by the client on create and on update', async () => {
            const created = await createCase({ caseCode: 'MIO' });
            expect(created.body.data.caseCode).not.toBe('MIO');
            expect(created.body.data.caseCode.startsWith(`CSA${ suffix }-`)).toBe(true);

            const updated = await updateCase(created.body.data.caseId, { caseCode: 'TUYO' });
            expect(updated.status).toBe(200);
            expect(updated.body.data.caseCode).toBe(created.body.data.caseCode);
        });

        it('does not regenerate the code when healthFacilityId or reportDate change', async () => {
            const created = await createCase();

            const facilityChanged = await updateCase(created.body.data.caseId, { healthFacilityId: otherFacilityId });
            expect(facilityChanged.body.data.caseCode).toBe(created.body.data.caseCode);
            expect(facilityChanged.body.data.healthFacility.localCode).toBe(`CSB${ suffix }`);

            const dateChanged = await updateCase(created.body.data.caseId, { reportDate: isoDate(-4) });
            expect(dateChanged.body.data.caseCode).toBe(created.body.data.caseCode);
        });

    });

    describe('002A and 002B — the two lists', () => {

        let listFacilityId: string;
        let listPatientId: string;
        let inactiveCaseId: string;

        beforeAll(async () => {
            listFacilityId = await createFacilityFixture('LST');
            listPatientId = await createPatientFixture('LST');

            await createCase({ healthFacilityId: listFacilityId, patientId: listPatientId });
            await createCase({ healthFacilityId: listFacilityId, patientId: listPatientId, reportDate: isoDate(-3) });
            await createCase({ healthFacilityId: listFacilityId, patientId: otherPatientId });

            const inactive = await createCase({ healthFacilityId: listFacilityId, patientId: listPatientId });
            inactiveCaseId = inactive.body.data.caseId;
            await deleteCase(inactiveCaseId);
        });

        it('hides inactive rows on 002A and shows them on 002B', async () => {
            const publicList = await listCases(`?healthFacilityId=${ listFacilityId }`);
            expect(publicList.status).toBe(200);
            expect(publicList.body.data.count).toBe(3);
            expect(publicList.body.data.rows.some(( row: { caseId: string } ) => row.caseId === inactiveCaseId)).toBe(false);

            const adminList = await listAdminCases(`?healthFacilityId=${ listFacilityId }`);
            expect(adminList.status).toBe(200);
            expect(adminList.body.data.count).toBe(4);
            expect(adminList.body.data.rows.some(( row: { caseId: string } ) => row.caseId === inactiveCaseId)).toBe(true);
        });

        it('refuses a USER on 002B', async () => {
            expect(( await listAdminCases('', 'USER') ).status).toBe(403);
        });

        it('answers 200 with an empty page when a filter points at an unknown UUID', async () => {
            const response = await listCases(`?patientId=${ unknownUuid }`);
            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
            expect(response.body.data.rows).toEqual([]);
        });

        it('bounds the reportDate range by each end and by both', async () => {
            const base = `?healthFacilityId=${ listFacilityId }`;

            const both = await listCases(`${ base }&reportDateFrom=${ isoDate(-1) }&reportDateTo=${ isoDate(0) }`);
            expect(both.body.data.count).toBe(2);

            const fromOnly = await listCases(`${ base }&reportDateFrom=${ isoDate(-1) }`);
            expect(fromOnly.body.data.count).toBe(2);

            const toOnly = await listCases(`${ base }&reportDateTo=${ isoDate(-2) }`);
            expect(toOnly.body.data.count).toBe(1);
        });

        it('applies the three filters with AND', async () => {
            const matching = await listCases(
                `?healthFacilityId=${ listFacilityId }&patientId=${ listPatientId }&reportDateFrom=${ isoDate(-10) }`
            );
            expect(matching.body.data.count).toBe(2);

            // The same patient on a facility they have no case in
            const impossible = await listCases(
                `?healthFacilityId=${ otherFacilityId }&patientId=${ listPatientId }&reportDateFrom=${ isoDate(-10) }`
            );
            expect(impossible.body.data.count).toBe(0);
        });

        it('returns the reduced shape, ordered by reportDate and broken by caseCode', async () => {
            const response = await listCases(`?healthFacilityId=${ listFacilityId }`);
            const [first, second] = response.body.data.rows;

            expect(Object.keys(first).sort()).toEqual(
                ['caseCode', 'caseId', 'eventDate', 'healthFacility', 'isActive', 'patient', 'reportDate'].sort()
            );
            expect(first.details).toBeUndefined();
            expect(first.countryIsoCode).toBeUndefined();
            expect(first.reportFillingDate).toBeUndefined();
            expect(first.notificationOrganization).toBeUndefined();
            expect(first.appDetails).toBeUndefined();
            expect(first.sysDetails).toBeUndefined();

            // The list row names the patient without identifying them
            expect(Object.keys(first.patient).sort()).toEqual(
                ['firstName', 'healthSystemCode', 'lastName', 'patientId'].sort()
            );
            const ownRow = response.body.data.rows
                .find(( row: { patient: { patientId: string } } ) => row.patient.patientId === listPatientId);
            expect(ownRow.patient.firstName).toBe('Case LST');

            expect(first.reportDate >= second.reportDate).toBe(true);
            expect(first.caseCode > second.caseCode).toBe(true);
        });

        it('paginates with limit and reports the total count', async () => {
            const response = await listCases(`?healthFacilityId=${ listFacilityId }&limit=2`);
            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.count).toBe(3);
        });

    });

    describe('003 — get by id', () => {

        it('answers 404 for an unknown id', async () => {
            const response = await getCase(unknownUuid);
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('CASE_003_NOT_FOUND');
        });

        it('does not capture the literal /admin path as an :id', async () => {
            const response = await listAdminCases();
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data.rows)).toBe(true);
        });

        // canViewInactive is SUPERADMIN-only today (permissions.helper.ts:24-26)
        it('hides an inactive case from USER and ADMIN, and shows it to SUPERADMIN', async () => {
            const created = await createCase();
            await deleteCase(created.body.data.caseId);

            expect(( await getCase(created.body.data.caseId, 'USER') ).status).toBe(404);
            expect(( await getCase(created.body.data.caseId, 'ADMIN') ).status).toBe(404);

            const asSuperAdmin = await getCase(created.body.data.caseId, 'SUPERADMIN');
            expect(asSuperAdmin.status).toBe(200);
            expect(asSuperAdmin.body.data.isActive).toBe(false);
            expect(asSuperAdmin.body.data.sysDetails).toBeUndefined();
        });

    });

    describe('004 — update', () => {

        it('checks date coherence against the resulting state, not against the body', async () => {
            const created = await createCase({ reportDate: isoDate(-4) });

            // Only eventDate travels: it is compared with the stored reportDate
            const incoherent = await updateCase(created.body.data.caseId, { eventDate: isoDate(-2) });
            expect(incoherent.status).toBe(400);
            expect(incoherent.body.code).toBe('CASE_004_INVALID_DATE_RANGE');

            const coherent = await updateCase(created.body.data.caseId, { eventDate: isoDate(-6) });
            expect(coherent.status).toBe(200);
            expect(coherent.body.data.eventDate).toBe(isoDate(-6));

            // And moving the report date below the stored event date is rejected too
            const movedReport = await updateCase(created.body.data.caseId, { reportDate: isoDate(-8) });
            expect(movedReport.status).toBe(400);
        });

        it('rejects an inactive patient, an unknown facility and an unknown case with 404', async () => {
            const created = await createCase();

            const inactivePatient = await updateCase(created.body.data.caseId, { patientId: inactivePatientId });
            expect(inactivePatient.status).toBe(404);
            expect(inactivePatient.body.code).toBe('CASE_004_PATIENT_NOT_FOUND');

            const unknownFacility = await updateCase(created.body.data.caseId, { healthFacilityId: unknownUuid });
            expect(unknownFacility.status).toBe(404);
            expect(unknownFacility.body.code).toBe('CASE_004_FACILITY_NOT_FOUND');

            const unknownCase = await updateCase(unknownUuid, { details: 'x' });
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('CASE_004_NOT_FOUND');
        });

        it('appends to appDetails without dropping the previous entries', async () => {
            const created = await createCase();
            expect(created.body.data.appDetails).toHaveLength(1);

            const empty = await updateCase(created.body.data.caseId, {});
            expect(empty.status).toBe(200);
            expect(empty.body.data.appDetails).toHaveLength(2);
            expect(empty.body.data.appDetails[0].method).toBe('ESAVI-CASE-001');
            expect(empty.body.data.appDetails[1].method).toBe('ESAVI-CASE-004');

            const second = await updateCase(created.body.data.caseId, { countryIsoCode: ' ec ' });
            expect(second.body.data.appDetails).toHaveLength(3);
            expect(second.body.data.countryIsoCode).toBe('EC');
        });

    });

    describe('005A and 005B — deactivate and reactivate', () => {

        it('seals deletedAt on delete and clears it on activate, both without data', async () => {
            const created = await createCase();

            const deleted = await deleteCase(created.body.data.caseId);
            expect(deleted.status).toBe(200);
            expect(deleted.body.data).toBeUndefined();

            const deactivated = await EsaviCase.findByPk(created.body.data.caseId);
            expect(deactivated?.getDataValue('isActive')).toBe(false);
            expect(deactivated?.getDataValue('deletedAt')).not.toBeNull();

            const activated = await activateCase(created.body.data.caseId);
            expect(activated.status).toBe(200);
            expect(activated.body.data).toBeUndefined();

            const reactivated = await EsaviCase.findByPk(created.body.data.caseId);
            expect(reactivated?.getDataValue('isActive')).toBe(true);
            expect(reactivated?.getDataValue('deletedAt')).toBeNull();

            // The audit entry keeps the bare operation code, with no suffix behind it
            const appDetails = reactivated?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-CASE-001', 'ESAVI-CASE-005A', 'ESAVI-CASE-005B'
            ]);
        });

        it('answers 409 when repeating the state', async () => {
            const created = await createCase();
            await deleteCase(created.body.data.caseId);

            const twice = await deleteCase(created.body.data.caseId);
            expect(twice.status).toBe(409);
            expect(twice.body.code).toBe('CASE_005A_ALREADY_INACTIVE');

            await activateCase(created.body.data.caseId);
            const activeTwice = await activateCase(created.body.data.caseId);
            expect(activeTwice.status).toBe(409);
            expect(activeTwice.body.code).toBe('CASE_005B_ALREADY_ACTIVE');
        });

        it('refuses an ADMIN on activate and a USER on delete', async () => {
            const created = await createCase();

            expect(( await activateCase(created.body.data.caseId, 'ADMIN') ).status).toBe(403);
            expect(( await deleteCase(created.body.data.caseId, 'USER') ).status).toBe(403);
        });

        it('answers 404 for an unknown id on both operations', async () => {
            expect(( await deleteCase(unknownUuid) ).status).toBe(404);
            expect(( await activateCase(unknownUuid) ).status).toBe(404);
        });

    });

    /**
     * The cascade SPEC F07 added to 005A. It is the only place where deactivating
     * a case writes outside its own row, and it only goes downwards: 005B brings
     * nothing back, on purpose, because reactivating in cascade would resurrect
     * notifiers somebody retired before touching the case.
     */
    describe('005A — the cascade over notifier', () => {

        const createNotifier = async ( caseId: string, firstName: string ): Promise<string> => {
            const response = await request(app)
                .post('/api/notifiers')
                .set(authHeader('USER'))
                .send({ caseId, firstName, lastName: 'Cascada' });
            return response.body.data.notifierId;
        };

        it('drags every active notifier of the case, sealing deletedAt', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const first = await createNotifier(caseId, 'Uno');
            const second = await createNotifier(caseId, 'Dos');

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            for( const notifierId of [first, second] ) {
                const notifier = await Notifier.findByPk(notifierId);
                expect(notifier?.getDataValue('isActive')).toBe(false);
                expect(notifier?.getDataValue('deletedAt')).not.toBeNull();
                // The method is the code of the operation that deactivated it, not 005A of notifier
                const appDetails = notifier?.getDataValue('appDetails') as { method: string }[];
                expect(appDetails.map(entry => entry.method)).toEqual([
                    'ESAVI-NOTIFIER-001', 'ESAVI-CASE-005A'
                ]);
            }
        });

        it('brings no notifier back when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notifierId = await createNotifier(caseId, 'Vuelta');
            await deleteCase(caseId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const notifier = await Notifier.findByPk(notifierId);
            expect(notifier?.getDataValue('isActive')).toBe(false);
            expect(notifier?.getDataValue('deletedAt')).not.toBeNull();
        });

        it('leaves a notifier retired beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notifierId = await createNotifier(caseId, 'Previo');
            await request(app).delete(`/api/notifiers/${ notifierId }`).set(authHeader('ADMIN'));

            const before = await Notifier.findByPk(notifierId);
            const ownDeletedAt = before?.getDataValue('deletedAt') as Date;
            const entriesBefore = ( before?.getDataValue('appDetails') as unknown[] ).length;

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await Notifier.findByPk(notifierId);
            expect(( after?.getDataValue('deletedAt') as Date ).getTime()).toBe(ownDeletedAt.getTime());
            expect(after?.getDataValue('appDetails') as unknown[]).toHaveLength(entriesBefore);
        });

        it('answers 200 for a case with no notifiers at all', async () => {
            const created = await createCase();

            expect(( await deleteCase(created.body.data.caseId) ).status).toBe(200);
        });

        it('changes no notifier when the case was already inactive', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notifierId = await createNotifier(caseId, 'Intacto');
            await deleteCase(caseId);
            await request(app).patch(`/api/notifiers/activate/${ notifierId }`).set(authHeader('SUPERADMIN'));

            const response = await deleteCase(caseId);

            // The generic service threw the 409 before the cascade could run
            expect(response.status).toBe(409);
            const notifier = await Notifier.findByPk(notifierId);
            expect(notifier?.getDataValue('isActive')).toBe(true);
            expect(notifier?.getDataValue('deletedAt')).toBeNull();
        });

        it('does not expose notifiers in any response of esavi-cases', async () => {
            const created = await createCase();
            await createNotifier(created.body.data.caseId, 'Oculto');

            const detail = await getCase(created.body.data.caseId);
            const list = await listCases();

            expect(detail.body.data).not.toHaveProperty('notifiers');
            expect(list.body.data.rows[0]).not.toHaveProperty('notifiers');
        });

    });

    /**
     * SPEC F09 adds the classification to the same cascade, at the same point and
     * inside the same transaction. It proves the mechanism SPEC F07 built was
     * extensible and not a one-off for notifier. The asymmetry is unchanged: 005B
     * reactivates nothing. The patients of this suite carry no birth date, so the
     * age falls back to the body and the ageUnit catalog is not needed here.
     */
    describe('005A — the cascade over classification', () => {

        const createClassification = async ( caseId: string ): Promise<string> => {
            const response = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ caseId, isSeriousEvent: false });
            return response.body.data.classificationId;
        };

        it('drags the active classification of the case, sealing deletedAt', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const classificationId = await createClassification(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const classification = await Classification.findByPk(classificationId);
            expect(classification?.getDataValue('isActive')).toBe(false);
            expect(classification?.getDataValue('deletedAt')).not.toBeNull();
            // The method is the code of the operation that deactivated it, not 005A of classification
            const appDetails = classification?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-CLASSIF-001', 'ESAVI-CASE-005A'
            ]);
        });

        it('brings the classification back on no account when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const classificationId = await createClassification(caseId);
            await deleteCase(caseId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const classification = await Classification.findByPk(classificationId);
            expect(classification?.getDataValue('isActive')).toBe(false);
            expect(classification?.getDataValue('deletedAt')).not.toBeNull();
        });

        it('leaves a classification retired beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const classificationId = await createClassification(caseId);
            await request(app).delete(`/api/classifications/${ classificationId }`).set(authHeader('ADMIN'));

            const before = await Classification.findByPk(classificationId);
            const ownDeletedAt = before?.getDataValue('deletedAt') as Date;
            const entriesBefore = ( before?.getDataValue('appDetails') as unknown[] ).length;

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await Classification.findByPk(classificationId);
            expect(( after?.getDataValue('deletedAt') as Date ).getTime()).toBe(ownDeletedAt.getTime());
            expect(after?.getDataValue('appDetails') as unknown[]).toHaveLength(entriesBefore);
        });

        it('answers 200 for a case with no classification at all', async () => {
            const created = await createCase();

            expect(( await deleteCase(created.body.data.caseId) ).status).toBe(200);
        });

        it('changes no classification when the case was already inactive', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const classificationId = await createClassification(caseId);
            await deleteCase(caseId);
            await request(app).patch(`/api/classifications/activate/${ classificationId }`).set(authHeader('SUPERADMIN'));

            const response = await deleteCase(caseId);

            // The generic service threw the 409 before the cascade could run
            expect(response.status).toBe(409);
            const classification = await Classification.findByPk(classificationId);
            expect(classification?.getDataValue('isActive')).toBe(true);
            expect(classification?.getDataValue('deletedAt')).toBeNull();
        });

        it('drags classification and notifiers in the same operation', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const classificationId = await createClassification(caseId);
            const notifier = await request(app)
                .post('/api/notifiers')
                .set(authHeader('USER'))
                .send({ caseId, firstName: 'Ambos', lastName: 'Cascada' });

            await deleteCase(caseId);

            const classification = await Classification.findByPk(classificationId);
            const stored = await Notifier.findByPk(notifier.body.data.notifierId);
            expect(classification?.getDataValue('isActive')).toBe(false);
            expect(stored?.getDataValue('isActive')).toBe(false);
        });

        it('does not expose the classification in any response of esavi-cases', async () => {
            const created = await createCase();
            await createClassification(created.body.data.caseId);

            const detail = await getCase(created.body.data.caseId);
            const list = await listCases();

            expect(detail.body.data).not.toHaveProperty('classification');
            expect(list.body.data.rows[0]).not.toHaveProperty('classification');
        });

    });

});
