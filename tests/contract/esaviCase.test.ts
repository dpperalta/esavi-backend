import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType, Classification, EsaviCase, HealthFacility, Investigation, InvestigationSource, Notification, NonSevereNotification, Notifier, Patient, SevereNotification } from '../../src/models';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
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

        it('rejects an unknown facility and an unknown case with 404', async () => {
            const created = await createCase();

            const unknownFacility = await updateCase(created.body.data.caseId, { healthFacilityId: unknownUuid });
            expect(unknownFacility.status).toBe(404);
            expect(unknownFacility.body.code).toBe('CASE_004_FACILITY_NOT_FOUND');

            const unknownCase = await updateCase(unknownUuid, { details: 'x' });
            expect(unknownCase.status).toBe(404);
            expect(unknownCase.body.code).toBe('CASE_004_NOT_FOUND');
        });

        it('ignores patientId without an error, whatever it points at', async () => {
            const created = await createCase();

            // A valid patient other than its own: 200 and the case keeps the original one
            const moved = await updateCase(created.body.data.caseId, { patientId: otherPatientId });
            expect(moved.status).toBe(200);
            expect(moved.body.data.patient.patientId).toBe(patientId);

            // An inactive one and an unknown one no longer raise a 404: the field is not even read
            const toInactive = await updateCase(created.body.data.caseId, { patientId: inactivePatientId });
            expect(toInactive.status).toBe(200);
            expect(toInactive.body.data.patient.patientId).toBe(patientId);

            const toUnknown = await updateCase(created.body.data.caseId, { patientId: unknownUuid });
            expect(toUnknown.status).toBe(200);
            expect(toUnknown.body.data.patient.patientId).toBe(patientId);

            // And an ignored field is not a change: nothing was written along the way
            expect(toUnknown.body.data.appDetails).toHaveLength(1);
            expect(toUnknown.body.data.appDetails[0].method).toBe('ESAVI-CASE-001');
        });

        it('appends to appDetails only when something changed, without dropping the previous entries', async () => {
            const created = await createCase();
            expect(created.body.data.appDetails).toHaveLength(1);

            // An empty body changes nothing, so it writes nothing: appDetails counts changes,
            // not the times a form was opened and closed
            const empty = await updateCase(created.body.data.caseId, {});
            expect(empty.status).toBe(200);
            expect(empty.body.data.appDetails).toHaveLength(1);
            expect(empty.body.data.appDetails[0].method).toBe('ESAVI-CASE-001');

            const second = await updateCase(created.body.data.caseId, { countryIsoCode: ' ec ' });
            expect(second.body.data.appDetails).toHaveLength(2);
            expect(second.body.data.appDetails[1].method).toBe('ESAVI-CASE-004');
            expect(second.body.data.countryIsoCode).toBe('EC');

            // And resending the value it already holds writes nothing either
            const third = await updateCase(created.body.data.caseId, { countryIsoCode: 'EC' });
            expect(third.status).toBe(200);
            expect(third.body.data.appDetails).toHaveLength(2);
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

    /**
     * SPEC F10 adds the notification as the third satellite of the same cascade,
     * at the same point and inside the same transaction. The asymmetry is unchanged:
     * 005B reactivates nothing.
     */
    describe('005A — the cascade over notification', () => {

        const createNotification = async ( caseId: string ): Promise<string> => {
            const response = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fiebre tras la dosis' });
            return response.body.data.notificationId;
        };

        it('drags the active notification of the case, sealing deletedAt', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNotification(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const notification = await Notification.findByPk(notificationId);
            expect(notification?.getDataValue('isActive')).toBe(false);
            expect(notification?.getDataValue('deletedAt')).not.toBeNull();
            // The method is the code of the operation that deactivated it, not 005A of notification
            const appDetails = notification?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-NOTIFCN-001', 'ESAVI-CASE-005A'
            ]);
        });

        it('brings the notification back on no account when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNotification(caseId);
            await deleteCase(caseId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const notification = await Notification.findByPk(notificationId);
            expect(notification?.getDataValue('isActive')).toBe(false);
            expect(notification?.getDataValue('deletedAt')).not.toBeNull();
        });

        it('leaves a notification retired beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNotification(caseId);
            await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

            const before = await Notification.findByPk(notificationId);
            const ownDeletedAt = before?.getDataValue('deletedAt') as Date;
            const entriesBefore = ( before?.getDataValue('appDetails') as unknown[] ).length;

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await Notification.findByPk(notificationId);
            expect(( after?.getDataValue('deletedAt') as Date ).getTime()).toBe(ownDeletedAt.getTime());
            expect(after?.getDataValue('appDetails') as unknown[]).toHaveLength(entriesBefore);
        });

    });

    /**
     * SPEC F28 adds the investigation to the same cascade, at the same point and
     * inside the same transaction. It is one to one with the case through
     * UQ_investigation_case, so it is at most one row, and the asymmetry is
     * unchanged: 005B reactivates nothing. Its fourteen detail tables are out of
     * scope — nothing walks down from here to them.
     */
    describe('005A — the cascade over investigation', () => {

        const createInvestigation = async ( caseId: string ): Promise<string> => {
            const response = await request(app)
                .post('/api/investigations')
                .set(authHeader('USER'))
                .send({ caseId });
            return response.body.data.investigationId;
        };

        it('drags the active investigation of the case, sealing deletedAt', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createInvestigation(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const investigation = await Investigation.findByPk(investigationId);
            expect(investigation?.getDataValue('isActive')).toBe(false);
            expect(investigation?.getDataValue('deletedAt')).not.toBeNull();
            // The method is the code of the operation that deactivated it, not 005A of investigation
            const appDetails = investigation?.getDataValue('appDetails') as { method: string }[];
            expect(appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-INVESTGN-001', 'ESAVI-CASE-005A'
            ]);
        });

        it('brings the investigation back on no account when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createInvestigation(caseId);
            await deleteCase(caseId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const investigation = await Investigation.findByPk(investigationId);
            expect(investigation?.getDataValue('isActive')).toBe(false);
            expect(investigation?.getDataValue('deletedAt')).not.toBeNull();
        });

        it('leaves an investigation retired beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createInvestigation(caseId);
            await request(app).delete(`/api/investigations/${ investigationId }`).set(authHeader('ADMIN'));

            const before = await Investigation.findByPk(investigationId);
            const ownDeletedAt = before?.getDataValue('deletedAt') as Date;
            const entriesBefore = ( before?.getDataValue('appDetails') as unknown[] ).length;

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await Investigation.findByPk(investigationId);
            expect(( after?.getDataValue('deletedAt') as Date ).getTime()).toBe(ownDeletedAt.getTime());
            expect(after?.getDataValue('appDetails') as unknown[]).toHaveLength(entriesBefore);
        });

        it('a case with no investigation deactivates zero rows and does not fail', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            expect(await Investigation.findOne({ where: { caseId } })).toBeNull();
        });

    });

    /**
     * SPEC F13 adds the severe detail as the fourth satellite, and the only one
     * reached in two hops: the chain case -> notification -> detail has to be walked
     * explicitly, because the mass Notification.update above does not go through
     * notification.service.ts and the cascade installed there never fires from here.
     * The detail has no isActive column, so what moves is its deletedAt — and that
     * seal is what makes it purgable later. Without it a detail under a deactivated
     * case would be invisible but unsealed, and therefore never purgable.
     */
    describe('005A — the cascade over the severe detail', () => {

        // A SEVERE notification with its detail, which is the only chain that reaches one
        const createSevereChain = async ( caseId: string ): Promise<string> => {
            const notified = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'SEVERE', esaviDescription: 'Fiebre tras la dosis' });
            const notificationId = notified.body.data.notificationId;
            await request(app).post('/api/severe-notifications').set(authHeader('USER'))
                .send({ notificationId });
            return notificationId;
        };

        const readDetail = async ( id: string ) => {
            const row = await SevereNotification.findByPk(id);
            return {
                deletedAt: row!.getDataValue('deletedAt') as Date | null,
                appDetails: row!.getDataValue('appDetails') as { method: string }[]
            };
        };

        it('seals the detail transitively, in the same transaction that deactivates the notification', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createSevereChain(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const detail = await readDetail(notificationId);
            expect(detail.deletedAt).not.toBeNull();
            // The method is the code of the operation that dragged it, never an ESAVI-SEVNOT one
            expect(detail.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-SEVNOT-001', 'ESAVI-CASE-005A'
            ]);
            expect(( await Notification.findByPk(notificationId) )?.getDataValue('isActive')).toBe(false);
        });

        it('does not undo it when the case is reactivated, because the notification does not come back either', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createSevereChain(caseId);
            await deleteCase(caseId);
            const sealed = await readDetail(notificationId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const after = await readDetail(notificationId);
            expect(after.deletedAt).toEqual(sealed.deletedAt);
            expect(after.appDetails).toHaveLength(sealed.appDetails.length);
        });

        it('leaves a detail sealed beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createSevereChain(caseId);
            // Sealed through its header, which is the other path of the drag
            await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

            const before = await readDetail(notificationId);
            expect(before.appDetails[1].method).toBe('ESAVI-NOTIFCN-005A');

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await readDetail(notificationId);
            expect(( after.deletedAt as Date ).getTime()).toBe(( before.deletedAt as Date ).getTime());
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('does not fail on a case with no notification, nor on one whose notification has no detail', async () => {
            const bare = await createCase();
            expect(( await deleteCase(bare.body.data.caseId) ).status).toBe(200);

            const withoutDetail = await createCase();
            const caseId = withoutDetail.body.data.caseId;
            const notified = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'SEVERE', esaviDescription: 'Fiebre tras la dosis' });

            expect(( await deleteCase(caseId) ).status).toBe(200);
            expect(await SevereNotification.findByPk(notified.body.data.notificationId)).toBeNull();
        });

        it('leaves the detail untouched when the case was already inactive and 005A answers 409', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createSevereChain(caseId);
            await deleteCase(caseId);
            const before = await readDetail(notificationId);

            // The generic service threw the 409 before the cascade could run again
            const response = await deleteCase(caseId);
            expect(response.status).toBe(409);

            const after = await readDetail(notificationId);
            expect(after.deletedAt).toEqual(before.deletedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('makes the dragged detail purgable, which is the point of sealing it', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createSevereChain(caseId);
            await deleteCase(caseId);

            const purged = await request(app)
                .delete(`/api/severe-notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await SevereNotification.findByPk(notificationId)).toBeNull();
        });

    });

    /**
     * SPEC F14 — the same two-hop chain for the non severe branch, the fifth satellite
     * reached from here. Same mechanism, same criterion for `method`, and the same
     * asymmetry: 005A seals it and 005B does not undo it, because the notification does
     * not come back either.
     */
    describe('005A — the cascade over the non severe detail', () => {

        const createNonSevereChain = async ( caseId: string ): Promise<string> => {
            const notified = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fiebre tras la dosis' });
            const notificationId = notified.body.data.notificationId;
            await request(app).post('/api/non-severe-notifications').set(authHeader('USER'))
                .send({ notificationId });
            return notificationId;
        };

        const readDetail = async ( id: string ) => {
            const row = await NonSevereNotification.findByPk(id);
            return {
                deletedAt: row!.getDataValue('deletedAt') as Date | null,
                appDetails: row!.getDataValue('appDetails') as { method: string }[]
            };
        };

        it('seals the detail transitively, in the same transaction that deactivates the notification', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNonSevereChain(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const detail = await readDetail(notificationId);
            expect(detail.deletedAt).not.toBeNull();
            // The method is the code of the operation that dragged it, never an ESAVI-NSEVNOT one
            expect(detail.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-NSEVNOT-001', 'ESAVI-CASE-005A'
            ]);
            expect(( await Notification.findByPk(notificationId) )?.getDataValue('isActive')).toBe(false);
        });

        it('does not undo it when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNonSevereChain(caseId);
            await deleteCase(caseId);
            const sealed = await readDetail(notificationId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const after = await readDetail(notificationId);
            expect(after.deletedAt).toEqual(sealed.deletedAt);
            expect(after.appDetails).toHaveLength(sealed.appDetails.length);
        });

        it('leaves a detail sealed beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNonSevereChain(caseId);
            // Sealed through its header, which is the other path of the drag
            await request(app).delete(`/api/notifications/${ notificationId }`).set(authHeader('ADMIN'));

            const before = await readDetail(notificationId);
            expect(before.appDetails[1].method).toBe('ESAVI-NOTIFCN-005A');

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await readDetail(notificationId);
            expect(( after.deletedAt as Date ).getTime()).toBe(( before.deletedAt as Date ).getTime());
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('does not fail on a case with no notification, nor on one whose notification has no detail', async () => {
            const bare = await createCase();
            expect(( await deleteCase(bare.body.data.caseId) ).status).toBe(200);

            const withoutDetail = await createCase();
            const caseId = withoutDetail.body.data.caseId;
            const notified = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'NON_SEVERE', esaviDescription: 'Fiebre tras la dosis' });

            expect(( await deleteCase(caseId) ).status).toBe(200);
            expect(await NonSevereNotification.findByPk(notified.body.data.notificationId)).toBeNull();
        });

        it('leaves the detail untouched when the case was already inactive and 005A answers 409', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNonSevereChain(caseId);
            await deleteCase(caseId);
            const before = await readDetail(notificationId);

            const response = await deleteCase(caseId);
            expect(response.status).toBe(409);

            const after = await readDetail(notificationId);
            expect(after.deletedAt).toEqual(before.deletedAt);
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('makes the dragged detail purgable, which is the point of sealing it', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notificationId = await createNonSevereChain(caseId);
            await deleteCase(caseId);

            const purged = await request(app)
                .delete(`/api/non-severe-notifications/purge/${ notificationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await NonSevereNotification.findByPk(notificationId)).toBeNull();
        });

        it('does not touch the non severe branch when the chain is SEVERE', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const notified = await request(app)
                .post('/api/notifications')
                .set(authHeader('USER'))
                .send({ caseId, notificationType: 'SEVERE', esaviDescription: 'Fiebre tras la dosis' });
            const notificationId = notified.body.data.notificationId;
            await request(app).post('/api/severe-notifications').set(authHeader('USER'))
                .send({ notificationId });

            expect(( await deleteCase(caseId) ).status).toBe(200);
            expect(await NonSevereNotification.findByPk(notificationId)).toBeNull();
            expect(( await SevereNotification.findByPk(notificationId) )?.getDataValue('deletedAt')).not.toBeNull();
        });

    });

    /**
     * SPEC F29 adds the investigation source as the sixth satellite reached from here,
     * and the second one walked in two hops: the chain case -> investigation -> source
     * has to be traversed explicitly, because the mass Investigation.update above does
     * not go through setInvestigationActivationService and the cascade installed there
     * never fires from this side. Without it the source of an investigation dragged by
     * its case would be invisible but unsealed, and therefore never purgable.
     * investigationSource has no isActive column either, so what moves is its deletedAt.
     */
    describe('005A — the cascade over the investigation source', () => {

        const createSourceChain = async ( caseId: string ): Promise<string> => {
            const investigation = await request(app)
                .post('/api/investigations')
                .set(authHeader('USER'))
                .send({ caseId });
            const investigationId = investigation.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER'))
                .send({ investigationId, history: true });
            return investigationId;
        };

        const readSource = async ( id: string ) => {
            const row = await InvestigationSource.findByPk(id);
            return {
                deletedAt: row!.getDataValue('deletedAt') as Date | null,
                appDetails: row!.getDataValue('appDetails') as { method: string }[]
            };
        };

        it('seals the source transitively, in the same transaction that deactivates the investigation', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createSourceChain(caseId);

            const response = await deleteCase(caseId);

            expect(response.status).toBe(200);
            const source = await readSource(investigationId);
            expect(source.deletedAt).not.toBeNull();
            // The method is the code of the operation that dragged it, never an ESAVI-INVSRC one.
            // It is also what proves this cascade fired and not the one of ESAVI-INVESTGN-005A
            expect(source.appDetails.map(entry => entry.method)).toEqual([
                'ESAVI-INVSRC-001', 'ESAVI-CASE-005A'
            ]);
            expect(( await Investigation.findByPk(investigationId) )?.getDataValue('isActive')).toBe(false);
        });

        it('does not undo it when the case is reactivated', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createSourceChain(caseId);
            await deleteCase(caseId);
            const sealed = await readSource(investigationId);

            const response = await activateCase(caseId);

            expect(response.status).toBe(200);
            const after = await readSource(investigationId);
            expect(after.deletedAt).toEqual(sealed.deletedAt);
            expect(after.appDetails).toHaveLength(sealed.appDetails.length);
        });

        it('leaves a source sealed beforehand with its own deletedAt and no new entry', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createSourceChain(caseId);
            // Sealed through its investigation, which is the other path of the drag
            await request(app).delete(`/api/investigations/${ investigationId }`).set(authHeader('ADMIN'));

            const before = await readSource(investigationId);
            expect(before.appDetails[1].method).toBe('ESAVI-INVESTGN-005A');

            // A second apart, so a deletedAt rewritten by the cascade would show
            await new Promise(resolve => setTimeout(resolve, 1100));
            await deleteCase(caseId);

            const after = await readSource(investigationId);
            expect(( after.deletedAt as Date ).getTime()).toBe(( before.deletedAt as Date ).getTime());
            expect(after.appDetails).toHaveLength(before.appDetails.length);
        });

        it('does not fail on a case with no investigation, nor on one whose investigation has no source', async () => {
            const bare = await createCase();
            expect(( await deleteCase(bare.body.data.caseId) ).status).toBe(200);

            const withoutSource = await createCase();
            const caseId = withoutSource.body.data.caseId;
            const investigation = await request(app)
                .post('/api/investigations')
                .set(authHeader('USER'))
                .send({ caseId });

            expect(( await deleteCase(caseId) ).status).toBe(200);
            expect(await InvestigationSource.findByPk(investigation.body.data.investigationId)).toBeNull();
        });

        it('makes the dragged source purgable, which is the point of sealing it', async () => {
            const created = await createCase();
            const caseId = created.body.data.caseId;
            const investigationId = await createSourceChain(caseId);
            await deleteCase(caseId);

            const purged = await request(app)
                .delete(`/api/investigation-sources/purge/${ investigationId }`)
                .set(authHeader('SUPERADMIN'));

            expect(purged.status).toBe(200);
            expect(await InvestigationSource.findByPk(investigationId)).toBeNull();
        });

    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await createCase({
                countryIsoCode: 'EC',
                notificationOrganization: 'Ministerio de Salud',
                details: 'Sin novedad'
            });
            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/esavi-cases',
                id: created.body.data.caseId,
                model: EsaviCase
            });
        });

    });

    // -----------------------------------------------------------------------
    // SPEC F11 — correcting eventDate propagates into the age of the classification
    // that was derived from it. The trigger is the real change of value, and a failed
    // recalculation rolls the PUT back: the case keeps its previous eventDate
    // -----------------------------------------------------------------------

    describe('age recalculation — SPEC F11', () => {

        let recalcCounter = 0;
        let datedPatientId: string;

        // The ageUnit catalogType is a precondition of SPEC F09 and esaviapp.sql does not seed it
        const seedAgeUnitCatalog = async (): Promise<void> => {
            const ageUnitType = await CatalogType.findOne({ where: { code: 'ageUnit' } })
                ?? await CatalogType.create({ code: 'ageUnit', name: 'Age Unit' });
            const catalogTypeId = ageUnitType.getDataValue('catalogTypeId');
            for( const code of ['YEARS', 'MONTHS', 'DAYS'] ) {
                const item = await CatalogItem.findOne({ where: { catalogTypeId, code } });
                if( !item ) {
                    await CatalogItem.create({ catalogTypeId, code, name: code, value: code });
                }
            }
        };

        // The shared fixture patient has no birthDate, and without it there is no age to
        // recalculate: this block needs one of its own, born long before every event date
        const createDatedPatient = async (): Promise<string> => {
            const patient = await Patient.create({
                firstName: esaviCrypt(`Case Age ${ suffix }`),
                lastName: esaviCrypt(`Probe ${ suffix }`),
                documentNumber: esaviCrypt(`CSAGE${ suffix }`),
                healthSystemCode: `CSAGE${ suffix }`,
                birthDate: '2000-05-04'
            });
            return patient.getDataValue('patientId');
        };

        // A case of the dated patient, classified, with an eventDate that is 24 years after
        // the birth. Its own facility because localCode is UNIQUE
        const classifiedCase = async (
            eventDate: string = '2024-05-04',
            reportDate: string = isoDate(0)
        ): Promise<{ caseId: string, classificationId: string }> => {
            recalcCounter += 1;
            const facility = await HealthFacility.create({
                localCode: `CSAG${ recalcCounter }${ suffix }`,
                name: `Case Age ${ recalcCounter } ${ suffix }`
            });
            const esaviCase = await EsaviCase.create({
                patientId: datedPatientId,
                healthFacilityId: facility.getDataValue('healthFacilityId'),
                caseCode: `CSAG-${ suffix }-${ recalcCounter }`,
                reportDate,
                eventDate
            });
            const caseId = esaviCase.getDataValue('caseId');
            const classified = await request(app)
                .post('/api/classifications')
                .set(authHeader('USER'))
                .send({ caseId, isSeriousEvent: false });
            return { caseId, classificationId: classified.body.data.classificationId };
        };

        const readClassification = ( caseId: string ) =>
            request(app)
                .get(`/api/classifications/case/${ caseId }`)
                .set(authHeader('USER'));

        beforeAll(async () => {
            await seedAgeUnitCatalog();
            datedPatientId = await createDatedPatient();
        });

        it('recalculates the active classification of the case and audits it as ESAVI-CASE-004', async () => {
            const { caseId } = await classifiedCase();
            const before = await readClassification(caseId);
            expect(before.body.data.age).toBe(24);

            const corrected = await updateCase(caseId, { eventDate: '2010-11-04' });
            expect(corrected.status).toBe(200);

            const after = await readClassification(caseId);
            expect(after.body.data.age).toBe(10);
            expect(after.body.data.ageUnit.code).toBe('YEARS');
            // The method is the code of the operation that moved it, not ESAVI-CLASSIF-004
            expect(after.body.data.appDetails).toHaveLength(2);
            expect(after.body.data.appDetails[0].method).toBe('ESAVI-CLASSIF-001');
            expect(after.body.data.appDetails[1].method).toBe('ESAVI-CASE-004');
        });

        it('does not touch the classification when eventDate did not change', async () => {
            const { caseId } = await classifiedCase();
            const before = await readClassification(caseId);

            const touched = await updateCase(caseId, { details: 'Solo esto' });
            expect(touched.status).toBe(200);

            const after = await readClassification(caseId);
            expect(after.body.data.age).toBe(24);
            expect(after.body.data.appDetails).toHaveLength(1);
            expect(after.body.data.updatedAt).toBe(before.body.data.updatedAt);
        });

        it('answers 200 for a case with no classification and for one whose classification is inactive', async () => {
            const plain = await createCase({ eventDate: isoDate(-4) });
            const moved = await updateCase(plain.body.data.caseId, { eventDate: isoDate(-6) });
            expect(moved.status).toBe(200);
            expect(moved.body.data.eventDate).toBe(isoDate(-6));

            const { caseId, classificationId } = await classifiedCase();
            await request(app).delete(`/api/classifications/${ classificationId }`).set(authHeader('ADMIN'));
            const before = await request(app)
                .get(`/api/classifications/${ classificationId }`)
                .set(authHeader('SUPERADMIN'));

            const withInactive = await updateCase(caseId, { eventDate: '2010-11-04' });
            expect(withInactive.status).toBe(200);

            const after = await request(app)
                .get(`/api/classifications/${ classificationId }`)
                .set(authHeader('SUPERADMIN'));
            expect(after.body.data.age).toBe(24);
            expect(after.body.data.updatedAt).toBe(before.body.data.updatedAt);
            expect(after.body.data.appDetails).toHaveLength(2);
            expect(after.body.data.appDetails[1].method).toBe('ESAVI-CLASSIF-005A');
        });

        it('answers 409 and keeps the previous eventDate when the event would precede the birth', async () => {
            const { caseId } = await classifiedCase();

            const invalid = await updateCase(caseId, { eventDate: '1999-01-01' });
            expect(invalid.status).toBe(409);
            expect(invalid.body.code).toBe('CASE_004_AGE_RECALC_INVALID_RANGE');

            const stored = await getCase(caseId);
            expect(stored.body.data.eventDate).toBe('2024-05-04');

            const classification = await readClassification(caseId);
            expect(classification.body.data.age).toBe(24);
            expect(classification.body.data.appDetails).toHaveLength(1);
        });

        it('checks the reportDate coherence before any recalculation', async () => {
            const { caseId } = await classifiedCase('2024-05-04', isoDate(-4));

            // An eventDate after the reportDate is a 400 of the case itself — two columns of the
            // same row — and it comes out before the recalculation, which crosses two tables
            const incoherent = await updateCase(caseId, { eventDate: isoDate(-2) });
            expect(incoherent.status).toBe(400);
            expect(incoherent.body.code).toBe('CASE_004_INVALID_DATE_RANGE');

            const classification = await readClassification(caseId);
            expect(classification.body.data.appDetails).toHaveLength(1);
        });

        it('keeps the stored age when eventDate is nulled, and recalculates when it comes back', async () => {
            const { caseId } = await classifiedCase();

            const nulled = await updateCase(caseId, { eventDate: null });
            expect(nulled.status).toBe(200);
            expect(nulled.body.data.eventDate).toBeNull();

            const kept = await readClassification(caseId);
            expect(kept.body.data.age).toBe(24);
            expect(kept.body.data.appDetails).toHaveLength(1);

            const restored = await updateCase(caseId, { eventDate: '2014-05-04' });
            expect(restored.status).toBe(200);

            const after = await readClassification(caseId);
            expect(after.body.data.age).toBe(14);
            expect(after.body.data.appDetails).toHaveLength(2);
        });

    });

});
