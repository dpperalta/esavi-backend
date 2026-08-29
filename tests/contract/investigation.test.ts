import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { CatalogItem, CatalogType, EsaviCase, GeoLevelType, GeoLocation, HealthFacility, Investigation, InvestigationAutopsy, InvestigationClinicalEvaluation, InvestigationMedicalHistory, InvestigationSource, InvestigationVaccinationContext, InvestigationColdChain, InvestigationAdministrationError, InvestigationCommunity, InvestigationVaccineAdministered, Patient, VaccineWhodrug } from '../../src/models';
import { app } from '../../src/app';
import { esaviCrypt } from '../../src/helpers/crypto.helper';
import { closeTestDatabase, seedCaseWorkflow } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';
import type { TestRole } from '../setup/auth';

/**
 * Contract suite for the nine investigation operations of SPEC F28. It walks the
 * entity end to end and covers what cannot be checked by hand reliably: the status
 * that is never left null and falls back to the item coded '0', the one to one
 * relation whose slot is not released by the soft delete but is by the purge, the
 * two distinct 404 of the access by case, and the differential update — the main
 * operation of an entity whose every data column is nullable, and the one place
 * where a regression would quietly fill appDetails and sysDetails on every save.
 */
describe('investigation contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();
    const unknownUuid = '00000000-0000-4000-8000-000000000000';

    // Fixtures shared by the whole file. Every case is minted fresh: the relation is one to one,
    // so two tests cannot share one
    let statusZeroItemId: string;
    let statusTwoItemId: string;
    let vaccinationSiteItemId: string;
    let wrongCatalogItemId: string;
    let facilityId: string;
    let inactiveFacilityId: string;
    let geoLocationId: string;
    let inactiveGeoLocationId: string;

    // errorHandler logs every error it handles, and a third of these tests trigger
    // errors on purpose, so the log is expected output rather than a signal
    let consoleError: jest.SpyInstance;

    let caseCounter = 0;

    const createCaseFixture = async (isActive: boolean = true): Promise<string> => {
        caseCounter += 1;
        const patient = await Patient.create({
            names: esaviCrypt(`Investigation ${ caseCounter }`),
            lastNames: esaviCrypt(`Probe ${ suffix }`),
            documentNumber: esaviCrypt(`IN${ caseCounter }${ suffix }`),
            healthSystemCode: `IN${ caseCounter }${ suffix }`,
            birthDate: '2000-05-04'
        });
        const facility = await HealthFacility.create({
            localCode: `IN${ caseCounter }${ suffix }`,
            name: `Investigation ${ caseCounter } ${ suffix }`
        });
        const esaviCase = await EsaviCase.create({
            patientId: patient.getDataValue('patientId'),
            healthFacilityId: facility.getDataValue('healthFacilityId'),
            caseCode: `IN-${ suffix }-${ caseCounter }`,
            reportDate: new Date().toISOString().slice(0, 10),
            eventDate: '2024-05-04',
            isActive
        });
        // SPEC F44: the case fixture is built on the model, so it needs its workflow row —
        // without it every POST of a stage answers 404 CASEFLOW_012_NOT_FOUND
        await seedCaseWorkflow(esaviCase.getDataValue('caseId'));
        return esaviCase.getDataValue('caseId');
    };

    // The catalogType coded 'vaccinationSite' is a deployment precondition of SPEC F28 and is NOT
    // seeded by esaviapp.sql, so the suite creates it with one item. Without it every create
    // sending vaccinationSiteItemId answers 404 vaccinationSiteNotFound
    const seedVaccinationSiteCatalog = async (): Promise<void> => {
        const type = await CatalogType.findOne({ where: { code: 'vaccinationSite' } })
            ?? await CatalogType.create({ code: 'vaccinationSite', name: 'Vaccination Site' });
        const catalogTypeId = type.getDataValue('catalogTypeId');
        const item = await CatalogItem.findOne({ where: { catalogTypeId, code: 'HEALTH_CENTER' } })
            ?? await CatalogItem.create({
                catalogTypeId,
                code: 'HEALTH_CENTER',
                name: 'Health Center',
                value: 'HEALTH_CENTER'
            });
        vaccinationSiteItemId = item.getDataValue('catalogItemId');
    };

    const createInvestigation = (payload: Record<string, unknown> = {}, role: TestRole = 'USER') =>
        request(app).post('/api/investigations').set(authHeader(role)).send(payload);

    const getById = (id: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigations/${ id }`).set(authHeader(role));

    const getByCase = (caseId: string, role: TestRole = 'USER') =>
        request(app).get(`/api/investigations/case/${ caseId }`).set(authHeader(role));

    const list = (query: string = '', role: TestRole = 'USER') =>
        request(app).get(`/api/investigations${ query }`).set(authHeader(role));

    const listAdmin = (query: string = '', role: TestRole = 'ADMIN') =>
        request(app).get(`/api/investigations/admin${ query }`).set(authHeader(role));

    const update = (id: string, payload: Record<string, unknown>, role: TestRole = 'USER') =>
        request(app).put(`/api/investigations/${ id }`).set(authHeader(role)).send(payload);

    const deactivate = (id: string, role: TestRole = 'ADMIN') =>
        request(app).delete(`/api/investigations/${ id }`).set(authHeader(role));

    const activate = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).patch(`/api/investigations/activate/${ id }`).set(authHeader(role));

    const purge = (id: string, role: TestRole = 'SUPERADMIN') =>
        request(app).delete(`/api/investigations/purge/${ id }`).set(authHeader(role));

    const readRow = async (id: string) => (await Investigation.findByPk(id))!;

    const versionOf = (row: Investigation) =>
        (row.getDataValue('sysDetails') as { version?: number } | null)?.version;

    beforeAll(async () => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        await seedTestUsers();
        await seedVaccinationSiteCatalog();

        const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
        const catalogTypeId = statusType!.getDataValue('catalogTypeId');
        statusZeroItemId = (await CatalogItem.findOne({ where: { catalogTypeId, code: '0' } }))!
            .getDataValue('catalogItemId');
        statusTwoItemId = (await CatalogItem.findOne({ where: { catalogTypeId, code: '2' } }))!
            .getDataValue('catalogItemId');

        // An active item of a different catalogType, to prove the type check bites on both FKs
        const otherType = await CatalogType.findOne({ where: { code: 'outcome' } });
        wrongCatalogItemId = (await CatalogItem.findOne({
            where: { catalogTypeId: otherType!.getDataValue('catalogTypeId') }
        }))!.getDataValue('catalogItemId');

        facilityId = (await HealthFacility.create({
            localCode: `INF${ suffix }`,
            name: `Vaccination facility ${ suffix }`
        })).getDataValue('healthFacilityId');
        inactiveFacilityId = (await HealthFacility.create({
            localCode: `INX${ suffix }`,
            name: `Inactive facility ${ suffix }`,
            isActive: false
        })).getDataValue('healthFacilityId');

        const levelType = await GeoLevelType.findOne()
            ?? await GeoLevelType.create({ code: `LV${ suffix }`, name: `Level ${ suffix }`, sortOrder: 1 });
        const geoLevelTypeId = levelType.getDataValue('geoLevelTypeId');
        geoLocationId = (await GeoLocation.create({
            geoLevelTypeId,
            name: `Vaccination geo ${ suffix }`,
            level: 1
        })).getDataValue('geoLocationId');
        inactiveGeoLocationId = (await GeoLocation.create({
            geoLevelTypeId,
            name: `Inactive geo ${ suffix }`,
            level: 1,
            isActive: false
        })).getDataValue('geoLocationId');
    });

    afterAll(async () => {
        consoleError.mockRestore();
        await closeTestDatabase();
    });

    // ---------------------------------------------------------------------------------------
    // The walkthrough: one investigation carried from its creation to its physical destruction
    // ---------------------------------------------------------------------------------------

    describe('the full walkthrough', () => {

        let caseId: string;
        let investigationId: string;

        it('001 — creates the investigation with every field and returns the full shape', async () => {
            caseId = await createCaseFixture();
            const response = await createInvestigation({
                caseId,
                statusItemId: statusTwoItemId,
                vaccinationSiteItemId,
                vaccinationHealthFacilityId: facilityId,
                vaccinationGeoLocationId: geoLocationId,
                hospitalizationDate: '2024-06-01',
                investigationStartDate: '2024-06-02',
                vaccinationLatitude: -0.1806532,
                vaccinationLongitude: -78.4678382,
                notes: '  walked through  '
            });

            expect(response.status).toBe(201);
            const { data } = response.body;
            investigationId = data.investigationId;

            // The five relations travel resolved, never as raw ids
            expect(data.case.caseId).toBe(caseId);
            expect(data.status.code).toBe('2');
            expect(data.vaccinationSite.catalogItemId).toBe(vaccinationSiteItemId);
            expect(data.vaccinationHealthFacility.healthFacilityId).toBe(facilityId);
            expect(data.vaccinationGeoLocation.geoLocationId).toBe(geoLocationId);
            // geoLocation has no code column, so the include carries name and level instead
            expect('level' in data.vaccinationGeoLocation).toBe(true);
            expect('code' in data.vaccinationGeoLocation).toBe(false);

            expect(data.hospitalizationDate).toBe('2024-06-01');
            expect(data.investigationStartDate).toBe('2024-06-02');
            expect(Number(data.vaccinationLatitude)).toBe(-0.1806532);
            expect(data.notes).toBe('walked through');
            expect(data.isActive).toBe(true);
            expect(data.appDetails).toHaveLength(1);
            expect(data.appDetails[0].method).toBe('ESAVI-INVESTGN-001');

            // sysDetails and the five raw foreign keys never leave the service
            expect(data.sysDetails).toBeUndefined();
            expect(data.caseId).toBeUndefined();
            expect(data.statusItemId).toBeUndefined();
            expect(data.vaccinationSiteItemId).toBeUndefined();
            expect(data.vaccinationHealthFacilityId).toBeUndefined();
            expect(data.vaccinationGeoLocationId).toBeUndefined();
        });

        it('003 — reads it back by ID with the same shape', async () => {
            const response = await getById(investigationId);
            expect(response.status).toBe(200);
            expect(response.body.data.investigationId).toBe(investigationId);
            expect(response.body.data.status.code).toBe('2');
            expect(response.body.data.sysDetails).toBeUndefined();
        });

        it('006 — reads it back by case, as the object and not as a collection', async () => {
            const response = await getByCase(caseId);
            expect(response.status).toBe(200);
            expect(Array.isArray(response.body.data)).toBe(false);
            expect(response.body.data.count).toBeUndefined();
            expect(response.body.data.rows).toBeUndefined();
            expect(response.body.data.investigationId).toBe(investigationId);
        });

        it('002A — lists it in the public listing with the reduced shape', async () => {
            const response = await list(`?caseId=${ caseId }`);
            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(1);

            const row = response.body.data.rows[0];
            expect(row.investigationId).toBe(investigationId);
            // The two coordinates do travel: they are what lets the client paint a map
            expect(row.vaccinationLatitude).not.toBeUndefined();
            expect(row.vaccinationLongitude).not.toBeUndefined();
            // The reduced shape drops these five
            expect(row.notes).toBeUndefined();
            expect(row.appDetails).toBeUndefined();
            expect(row.createdAt).toBeUndefined();
            expect(row.updatedAt).toBeUndefined();
            expect(row.deletedAt).toBeUndefined();
            expect(row.sysDetails).toBeUndefined();
        });

        it('002B — lists it in the admin listing too', async () => {
            const response = await listAdmin(`?caseId=${ caseId }`);
            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(1);
        });

        it('004 — updates it and the change is visible', async () => {
            const response = await update(investigationId, { notes: 'walked and updated' });
            expect(response.status).toBe(200);
            expect(response.body.data.notes).toBe('walked and updated');
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.appDetails[1].method).toBe('ESAVI-INVESTGN-004');
        });

        it('005A — deactivates it, sealing deletedAt', async () => {
            const response = await deactivate(investigationId);
            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();

            const row = await readRow(investigationId);
            expect(row.getDataValue('isActive')).toBe(false);
            expect(row.getDataValue('deletedAt')).not.toBeNull();
            // And it drops out of the public listing
            expect((await list(`?caseId=${ caseId }`)).body.data.count).toBe(0);
            expect((await listAdmin(`?caseId=${ caseId }`)).body.data.count).toBe(1);
        });

        it('005B — reactivates it, returning deletedAt to null', async () => {
            const response = await activate(investigationId);
            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();

            const row = await readRow(investigationId);
            expect(row.getDataValue('isActive')).toBe(true);
            expect(row.getDataValue('deletedAt')).toBeNull();
        });

        it('005C — deactivated again, it is physically destroyed', async () => {
            await deactivate(investigationId);
            const response = await purge(investigationId);
            expect(response.status).toBe(200);
            expect(response.body.data).toBeUndefined();
            expect(await Investigation.findByPk(investigationId, { paranoid: false })).toBeNull();
            // And the case it belonged to is intact
            const esaviCase = await EsaviCase.findByPk(caseId);
            expect(esaviCase).not.toBeNull();
            expect(esaviCase!.getDataValue('isActive')).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 001 — create
    // ---------------------------------------------------------------------------------------

    describe('001 — create', () => {

        it('creates with only caseId and resolves the status to the item "0"', async () => {
            const caseId = await createCaseFixture();
            const response = await createInvestigation({ caseId });

            expect(response.status).toBe(201);
            const { data } = response.body;
            expect(data.status.code).toBe('0');
            expect(data.vaccinationSite).toBeNull();
            expect(data.vaccinationHealthFacility).toBeNull();
            expect(data.vaccinationGeoLocation).toBeNull();
            expect(data.hospitalizationDate).toBeNull();
            expect(data.investigationStartDate).toBeNull();
            expect(data.vaccinationLatitude).toBeNull();
            expect(data.vaccinationLongitude).toBeNull();
            expect(data.notes).toBeNull();
        });

        it('a non-existent caseId answers 404', async () => {
            const response = await createInvestigation({ caseId: unknownUuid });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_CASE_NOT_FOUND');
        });

        it('an inactive caseId answers 404: a retired case is not investigated', async () => {
            const caseId = await createCaseFixture(false);
            const response = await createInvestigation({ caseId });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_CASE_NOT_FOUND');
        });

        it('a statusItemId of another catalogType answers 404', async () => {
            const caseId = await createCaseFixture();
            const response = await createInvestigation({ caseId, statusItemId: wrongCatalogItemId });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_STATUS_NOT_FOUND');
        });

        it('a vaccinationSiteItemId of another catalogType answers 404, not 200', async () => {
            const caseId = await createCaseFixture();
            const response = await createInvestigation({ caseId, vaccinationSiteItemId: wrongCatalogItemId });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_VACCINATION_SITE_NOT_FOUND');
        });

        it('an inactive vaccinationHealthFacilityId answers 404', async () => {
            const caseId = await createCaseFixture();
            const response = await createInvestigation({
                caseId,
                vaccinationHealthFacilityId: inactiveFacilityId
            });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_HEALTH_FACILITY_NOT_FOUND');
        });

        it('an inactive vaccinationGeoLocationId answers 404', async () => {
            const caseId = await createCaseFixture();
            const response = await createInvestigation({
                caseId,
                vaccinationGeoLocationId: inactiveGeoLocationId
            });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_001_GEO_LOCATION_NOT_FOUND');
        });

        it('each of the four foreign keys answers with a code of its own', async () => {
            const codes = new Set([
                'INVESTGN_001_STATUS_NOT_FOUND',
                'INVESTGN_001_VACCINATION_SITE_NOT_FOUND',
                'INVESTGN_001_HEALTH_FACILITY_NOT_FOUND',
                'INVESTGN_001_GEO_LOCATION_NOT_FOUND'
            ]);
            expect(codes.size).toBe(4);
        });

        // Since SPEC F46 the default status is resolved by { value: 'UNKNOWN', isValueLocked: true }
        // and no longer by code '0' with an isActive filter, so what breaks the deployment
        // precondition is the missing lock and not a deactivation: a withdrawn item still names what
        // it always named, which is the whole point of resolving without filtering by state
        it('with the item UNKNOWN unlocked, creating without statusItemId answers 500 with its own message', async () => {
            const caseId = await createCaseFixture();
            await CatalogItem.update({ isValueLocked: false }, { where: { catalogItemId: statusZeroItemId } });
            try {
                const response = await createInvestigation({ caseId });
                expect(response.status).toBe(500);
                expect(response.body.code).toBe('INVESTGN_001_DEFAULT_STATUS_MISSING');
                expect(response.body.message).not.toBe('Internal server error');
            } finally {
                await CatalogItem.update({ isValueLocked: true }, { where: { catalogItemId: statusZeroItemId } });
            }
        });

        // The counterpart of the case above, and the reason the lookup drops the isActive filter
        it('a deactivated UNKNOWN still resolves as the default status', async () => {
            const caseId = await createCaseFixture();
            await CatalogItem.update({ isActive: false }, { where: { catalogItemId: statusZeroItemId } });
            try {
                const response = await createInvestigation({ caseId });
                expect(response.status).toBe(201);
                expect(response.body.data.status.catalogItemId).toBe(statusZeroItemId);
            } finally {
                await CatalogItem.update({ isActive: true }, { where: { catalogItemId: statusZeroItemId } });
            }
        });

        it('a future hospitalizationDate or investigationStartDate answers 400', async () => {
            const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

            const hospitalization = await createInvestigation({
                caseId: await createCaseFixture(),
                hospitalizationDate: tomorrow
            });
            expect(hospitalization.status).toBe(400);

            const start = await createInvestigation({
                caseId: await createCaseFixture(),
                investigationStartDate: tomorrow
            });
            expect(start.status).toBe(400);
        });

        it('a coordinate with eight decimals answers 400, not a Postgres error', async () => {
            const response = await createInvestigation({
                caseId: await createCaseFixture(),
                vaccinationLatitude: 1.12345678
            });
            expect(response.status).toBe(400);
        });

        it('no relation between the two dates or against eventDate is validated', async () => {
            // A hospitalization earlier than the event of the case, and a start earlier than the
            // hospitalization: neither is checked, only that they are not in the future
            const response = await createInvestigation({
                caseId: await createCaseFixture(),
                hospitalizationDate: '2020-01-01',
                investigationStartDate: '2019-01-01'
            });
            expect(response.status).toBe(201);
        });
    });

    // ---------------------------------------------------------------------------------------
    // One to one
    // ---------------------------------------------------------------------------------------

    describe('one to one with the case', () => {

        it('a case with an active investigation answers 409 with the caseId in the message', async () => {
            const caseId = await createCaseFixture();
            expect((await createInvestigation({ caseId })).status).toBe(201);

            const response = await createInvestigation({ caseId });
            expect(response.status).toBe(409);
            expect(response.body.code).toBe('INVESTGN_001_CASE_ALREADY_INVESTIGATED');
            expect(response.body.message).toContain(caseId);
        });

        it('a case whose investigation is inactive answers 409 too: the slot is not released', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            await deactivate(created.body.data.investigationId);

            const response = await createInvestigation({ caseId });
            expect(response.status).toBe(409);
            expect(response.body.code).toBe('INVESTGN_001_CASE_ALREADY_INVESTIGATED');
        });

        it('purging with 005C releases the caseId and a later POST answers 201', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            await deactivate(created.body.data.investigationId);
            await purge(created.body.data.investigationId);

            const response = await createInvestigation({ caseId });
            expect(response.status).toBe(201);
        });

        it('sending caseId in the body of a PUT leaves the original case untouched and does not error', async () => {
            const caseId = await createCaseFixture();
            const otherCaseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            const id = created.body.data.investigationId;

            const response = await update(id, { caseId: otherCaseId });
            expect(response.status).toBe(200);
            expect(response.body.data.case.caseId).toBe(caseId);
            expect((await readRow(id)).getDataValue('caseId')).toBe(caseId);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 002A / 002B — the listings
    // ---------------------------------------------------------------------------------------

    describe('002A and 002B — the listings', () => {

        it('the public listing hides the inactive ones and the admin listing shows them', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            await deactivate(created.body.data.investigationId);

            expect((await list(`?caseId=${ caseId }`)).body.data.count).toBe(0);
            const admin = await listAdmin(`?caseId=${ caseId }`);
            expect(admin.body.data.count).toBe(1);
            expect(admin.body.data.rows[0].isActive).toBe(false);
        });

        it('a USER gets 403 on the admin listing', async () => {
            const response = await listAdmin('', 'USER');
            expect(response.status).toBe(403);
        });

        it('a filter with a non-existent UUID answers 200 with count 0, not 404', async () => {
            const response = await list(`?statusItemId=${ unknownUuid }`);
            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
            expect(response.body.data.rows).toEqual([]);
        });

        it('the four filters are combined with AND and by equality', async () => {
            const caseId = await createCaseFixture();
            await createInvestigation({
                caseId,
                statusItemId: statusTwoItemId,
                vaccinationHealthFacilityId: facilityId,
                vaccinationGeoLocationId: geoLocationId
            });

            const allFour = await list(
                `?caseId=${ caseId }&statusItemId=${ statusTwoItemId }` +
                `&vaccinationHealthFacilityId=${ facilityId }&vaccinationGeoLocationId=${ geoLocationId }`
            );
            expect(allFour.body.data.count).toBe(1);

            // One filter contradicting the rest empties the page: they are ANDed, not ORed
            expect((await list(`?caseId=${ caseId }&statusItemId=${ statusZeroItemId }`)).body.data.count).toBe(0);
            expect((await list(`?caseId=${ caseId }&vaccinationGeoLocationId=${ unknownUuid }`)).body.data.count).toBe(0);
        });

        it('?limit=2 returns two rows with the total count', async () => {
            for( let i = 0; i < 3; i += 1 ) {
                await createInvestigation({ caseId: await createCaseFixture() });
            }
            const response = await list('?limit=2');
            expect(response.status).toBe(200);
            expect(response.body.data.rows).toHaveLength(2);
            expect(response.body.data.count).toBeGreaterThan(2);
        });

        it('a filter that is not a UUID answers 400', async () => {
            expect((await list('?caseId=not-a-uuid')).status).toBe(400);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 003 and 006 — the two reads
    // ---------------------------------------------------------------------------------------

    describe('003 and 006 — the reads', () => {

        it('a non-existent ID answers 404', async () => {
            const response = await getById(unknownUuid);
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_003_NOT_FOUND');
        });

        it('the three optional includes come back as null and are not omitted', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const { data } = (await getById(created.body.data.investigationId)).body;

            expect(data.vaccinationSite).toBeNull();
            expect(data.vaccinationHealthFacility).toBeNull();
            expect(data.vaccinationGeoLocation).toBeNull();
            expect('vaccinationSite' in data).toBe(true);
            expect('vaccinationHealthFacility' in data).toBe(true);
            expect('vaccinationGeoLocation' in data).toBe(true);
        });

        it('an inactive investigation answers 404 for USER and ADMIN, 200 for SUPERADMIN', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await deactivate(id);

            expect((await getById(id, 'USER')).status).toBe(404);
            expect((await getById(id, 'ADMIN')).status).toBe(404);
            expect((await getById(id, 'SUPERADMIN')).status).toBe(200);
        });

        it('006 — a case without an investigation and a non-existent case answer different codes', async () => {
            const caseId = await createCaseFixture();
            const withoutInvestigation = await getByCase(caseId);
            expect(withoutInvestigation.status).toBe(404);
            expect(withoutInvestigation.body.code).toBe('INVESTGN_006_NOT_FOUND');

            const withoutCase = await getByCase(unknownUuid);
            expect(withoutCase.status).toBe(404);
            expect(withoutCase.body.code).toBe('INVESTGN_006_CASE_NOT_FOUND');

            expect(withoutInvestigation.body.code).not.toBe(withoutCase.body.code);
        });

        it('006 — a case whose investigation is inactive answers 404 for USER and 200 for SUPERADMIN', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            await deactivate(created.body.data.investigationId);

            expect((await getByCase(caseId, 'USER')).status).toBe(404);
            expect((await getByCase(caseId, 'ADMIN')).status).toBe(404);
            expect((await getByCase(caseId, 'SUPERADMIN')).status).toBe(200);
        });

        it('006 — a caseId that is not a UUID answers 400', async () => {
            expect((await getByCase('not-a-uuid')).status).toBe(400);
        });

        it('the literal paths are not captured as an :id', async () => {
            expect((await listAdmin()).status).toBe(200);
            expect((await getByCase(await createCaseFixture())).status).toBe(404);
        });
    });

    // ---------------------------------------------------------------------------------------
    // 004 — the differential update. The non-negotiable block of this suite
    // ---------------------------------------------------------------------------------------

    describe('004 — the differential update', () => {

        // A full investigation, so the PUT of its GET has something real to compare against
        const createFullInvestigation = async (): Promise<string> => {
            const created = await createInvestigation({
                caseId: await createCaseFixture(),
                statusItemId: statusTwoItemId,
                vaccinationSiteItemId,
                vaccinationHealthFacilityId: facilityId,
                vaccinationGeoLocationId: geoLocationId,
                hospitalizationDate: '2024-06-01',
                investigationStartDate: '2024-06-02',
                vaccinationLatitude: -0.1806532,
                vaccinationLongitude: -78.4678382,
                notes: 'differential'
            });
            return created.body.data.investigationId;
        };

        it('a PUT resending the whole GET response writes nothing', async () => {
            const id = await createFullInvestigation();
            await expectPutOfGetResponseWritesNothing({
                path: '/api/investigations',
                id,
                model: Investigation,
                role: 'USER'
            });
            // And the status it had is still the one it had, not downgraded to the default '0'
            expect((await readRow(id)).getDataValue('statusItemId')).toBe(statusTwoItemId);
        });

        it('a PUT with an empty body behaves the same', async () => {
            const id = await createFullInvestigation();
            const before = await readRow(id);

            const response = await update(id, {});
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);

            const after = await readRow(id);
            expect(after.getDataValue('updatedAt')).toEqual(before.getDataValue('updatedAt'));
            expect(versionOf(after)).toBe(versionOf(before));
            expect(after.getDataValue('statusItemId')).toBe(statusTwoItemId);
        });

        it('a PUT changing a single field adds one entry and bumps the version by 1', async () => {
            const id = await createFullInvestigation();
            const before = await readRow(id);

            const response = await update(id, { notes: 'changed once' });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(2);
            expect(response.body.data.appDetails[1].method).toBe('ESAVI-INVESTGN-004');

            const after = await readRow(id);
            expect(versionOf(after)).toBe((versionOf(before) ?? 0) + 1);
            expect(after.getDataValue('updatedAt')).not.toEqual(before.getDataValue('updatedAt'));
        });

        it('a PUT with an inactive foreign key answers 404 even when nothing else changes', async () => {
            const id = await createFullInvestigation();
            const before = await readRow(id);

            const response = await update(id, { vaccinationGeoLocationId: inactiveGeoLocationId });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_004_GEO_LOCATION_NOT_FOUND');
            // And nothing was written before the check
            expect((await readRow(id)).getDataValue('updatedAt')).toEqual(before.getDataValue('updatedAt'));
        });

        it('vaccinationLatitude: 0 is stored and notes: "" empties the field', async () => {
            const id = await createFullInvestigation();

            const response = await update(id, { vaccinationLatitude: 0, notes: '' });
            expect(response.status).toBe(200);
            expect(Number(response.body.data.vaccinationLatitude)).toBe(0);
            expect(response.body.data.notes).toBeNull();
        });

        it('resending the same coordinate is not a change, though pg returns a string', async () => {
            const id = await createFullInvestigation();
            const before = await readRow(id);
            const stored = (await getById(id)).body.data.vaccinationLatitude;

            expect(typeof stored).toBe('string');
            const response = await update(id, { vaccinationLatitude: Number(stored) });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(versionOf(await readRow(id))).toBe(versionOf(before));
        });

        it('resending the same hospitalizationDate is not a change', async () => {
            const id = await createFullInvestigation();
            const before = await readRow(id);
            const stored = (await getById(id)).body.data.hospitalizationDate;

            const response = await update(id, { hospitalizationDate: stored });
            expect(response.status).toBe(200);
            expect(response.body.data.appDetails).toHaveLength(1);
            expect(versionOf(await readRow(id))).toBe(versionOf(before));
        });

        it('the nullable fields can be emptied, one by one', async () => {
            const id = await createFullInvestigation();

            const response = await update(id, {
                vaccinationSiteItemId: null,
                vaccinationHealthFacilityId: null,
                vaccinationGeoLocationId: null,
                hospitalizationDate: null,
                investigationStartDate: null,
                vaccinationLatitude: null,
                vaccinationLongitude: null,
                notes: null
            });
            expect(response.status).toBe(200);
            const { data } = response.body;
            expect(data.vaccinationSite).toBeNull();
            expect(data.vaccinationHealthFacility).toBeNull();
            expect(data.vaccinationGeoLocation).toBeNull();
            expect(data.hospitalizationDate).toBeNull();
            expect(data.investigationStartDate).toBeNull();
            expect(data.vaccinationLatitude).toBeNull();
            expect(data.vaccinationLongitude).toBeNull();
            expect(data.notes).toBeNull();
        });

        it('a non-existent id answers 404', async () => {
            const response = await update(unknownUuid, { notes: 'x' });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_004_NOT_FOUND');
        });

        it('the service goes through buildDifferentialUpdate with no manual deletion of keys', () => {
            const source = fs.readFileSync('src/services/investigation.service.ts', 'utf8');
            expect(source).toContain('buildDifferentialUpdate');
            expect(source).not.toContain('delete objectToUpdate');
        });
    });

    // ---------------------------------------------------------------------------------------
    // The status, which is never null
    // ---------------------------------------------------------------------------------------

    describe('the investigation status', () => {

        it('investigationStatus holds exactly six items, coded "0" to "5"', async () => {
            const statusType = await CatalogType.findOne({ where: { code: 'investigationStatus' } });
            const items = await CatalogItem.findAll({
                where: { catalogTypeId: statusType!.getDataValue('catalogTypeId') },
                order: [['sortOrder', 'ASC']]
            });
            expect(items).toHaveLength(6);
            expect(items.map(item => item.getDataValue('code'))).toEqual(['0', '1', '2', '3', '4', '5']);
        });

        it('a PUT with statusItemId: null leaves the status on the item "0", never null', async () => {
            const created = await createInvestigation({
                caseId: await createCaseFixture(),
                statusItemId: statusTwoItemId
            });
            const id = created.body.data.investigationId;

            const response = await update(id, { statusItemId: null });
            expect(response.status).toBe(200);
            expect(response.body.data.status).not.toBeNull();
            expect(response.body.data.status.code).toBe('0');
            expect((await readRow(id)).getDataValue('statusItemId')).toBe(statusZeroItemId);
        });

        it('a PUT with another statusItemId moves the status', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            const response = await update(id, { statusItemId: statusTwoItemId });
            expect(response.status).toBe(200);
            expect(response.body.data.status.code).toBe('2');
        });

        it('a PUT with a statusItemId of another catalogType answers 404', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const response = await update(created.body.data.investigationId, {
                statusItemId: wrongCatalogItemId
            });
            expect(response.status).toBe(404);
            expect(response.body.code).toBe('INVESTGN_004_STATUS_NOT_FOUND');
        });

        it('no response of any operation returns status: null', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            const id = created.body.data.investigationId;

            expect(created.body.data.status).not.toBeNull();
            expect((await getById(id)).body.data.status).not.toBeNull();
            expect((await getByCase(caseId)).body.data.status).not.toBeNull();
            expect((await update(id, { notes: 'still there' })).body.data.status).not.toBeNull();
            expect((await list(`?caseId=${ caseId }`)).body.data.rows[0].status).not.toBeNull();
            expect((await listAdmin(`?caseId=${ caseId }`)).body.data.rows[0].status).not.toBeNull();
        });
    });

    // ---------------------------------------------------------------------------------------
    // 005A / 005B / 005C — the life cycle
    // ---------------------------------------------------------------------------------------

    describe('005A, 005B and 005C — the life cycle', () => {

        it('deactivating twice answers 409, and so does activating twice', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            expect((await deactivate(id)).status).toBe(200);
            const again = await deactivate(id);
            expect(again.status).toBe(409);
            expect(again.body.code).toBe('INVESTGN_005A_ALREADY_INACTIVE');

            expect((await activate(id)).status).toBe(200);
            const activatedAgain = await activate(id);
            expect(activatedAgain.status).toBe(409);
            expect(activatedAgain.body.code).toBe('INVESTGN_005B_ALREADY_ACTIVE');
        });

        it('an ADMIN gets 403 on activate and on purge', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await deactivate(id);

            expect((await activate(id, 'ADMIN')).status).toBe(403);
            expect((await purge(id, 'ADMIN')).status).toBe(403);
        });

        it('reactivating an investigation whose case is inactive answers 200', async () => {
            const caseId = await createCaseFixture();
            const created = await createInvestigation({ caseId });
            const id = created.body.data.investigationId;
            await deactivate(id);
            await EsaviCase.update({ isActive: false, deletedAt: new Date() }, { where: { caseId } });

            expect((await activate(id)).status).toBe(200);
        });

        it('the activation records its own method without going through the diff', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            await deactivate(id);
            let appDetails = (await readRow(id)).getDataValue('appDetails') as { method: string }[];
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-INVESTGN-005A');

            await activate(id);
            appDetails = (await readRow(id)).getDataValue('appDetails') as { method: string }[];
            expect(appDetails[appDetails.length - 1].method).toBe('ESAVI-INVESTGN-005B');
        });

        it('purging an active investigation answers 409 and the row survives', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            const response = await purge(id);
            expect(response.status).toBe(409);
            expect(response.body.code).toBe('INVESTGN_005C_STILL_ACTIVE');
            expect(response.body.message).toContain(id);
            expect(await Investigation.findByPk(id, { paranoid: false })).not.toBeNull();
        });

        it('purging twice answers 404 the second time', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await deactivate(id);

            expect((await purge(id)).status).toBe(200);
            const again = await purge(id);
            expect(again.status).toBe(404);
            expect(again.body.code).toBe('INVESTGN_005C_NOT_FOUND');
        });
    });

    // SPEC F29 hangs the first of the fourteen satellites off these three operations. What is
    // checked here is the effect on the source, seen from the side of the investigation: the
    // detailed behaviour of the entity lives in tests/contract/investigationSource.test.ts.
    // investigationSource has no isActive column, so what the cascades move is its deletedAt
    describe('the cascade over investigationSource', () => {

        // The source is created through its own endpoint, which is the only way it is ever born
        const createSource = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-sources')
                .set(authHeader('USER')).send({ investigationId, ...payload });

        const readSource = async (id: string) =>
            await InvestigationSource.findByPk(id, { paranoid: false });

        const sourceMethods = async (id: string): Promise<string[]> =>
            (((await readSource(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its source', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createSource(id, { history: true })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readSource(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await sourceMethods(id)).toEqual(['ESAVI-INVSRC-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the source, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createSource(id, { history: true });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const source = (await readSource(id))!;
            expect(source.getDataValue('deletedAt')).toBeNull();
            expect(source.getDataValue('history')).toBe(true);
            expect(await sourceMethods(id)).toEqual([
                'ESAVI-INVSRC-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('purging the investigation destroys the source by Postgres cascade without erroring', async () => {
            // The purge is not blocked when the investigation has a satellite: it is the decision
            // F29 declared, with the warn dump in the log as the only mitigation
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createSource(id);
            await deactivate(id);

            expect((await purge(id)).status).toBe(200);

            expect(await readSource(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();
        });
    });

    // SPEC F30 hangs the second of the fourteen satellites off the same three operations. What is
    // checked here is the effect on the autopsy, seen from the side of the investigation: the
    // detailed behaviour of the entity lives in tests/contract/investigationAutopsy.test.ts.
    // investigationAutopsy has no isActive column either, so what the cascades move is its
    // deletedAt. The last case is the one that matters most: the two satellites travel in the same
    // transaction, so neither spec may have broken the other
    describe('the cascade over investigationAutopsy', () => {

        // The autopsy is created through its own endpoint, which is the only way it is ever born.
        // Unlike the source it cannot be opened empty: isDeath and deathDate are required
        const createAutopsy = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-autopsies')
                .set(authHeader('USER'))
                .send({ investigationId, isDeath: true, deathDate: '2024-06-01', ...payload });

        const createSourceFor = (investigationId: string) =>
            request(app).post('/api/investigation-sources')
                .set(authHeader('USER')).send({ investigationId });

        const readAutopsy = async (id: string) =>
            await InvestigationAutopsy.findByPk(id, { paranoid: false });

        // The source is read here too, for the last case: the sibling helper of the block above
        // is scoped to that describe
        const readSourceRow = async (id: string) =>
            await InvestigationSource.findByPk(id, { paranoid: false });

        const autopsyMethods = async (id: string): Promise<string[]> =>
            (((await readAutopsy(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its autopsy', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createAutopsy(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readAutopsy(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await autopsyMethods(id)).toEqual(['ESAVI-INVAUT-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the autopsy, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAutopsy(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const autopsy = (await readAutopsy(id))!;
            expect(autopsy.getDataValue('deletedAt')).toBeNull();
            expect(autopsy.getDataValue('notes')).toBe('a note');
            expect(await autopsyMethods(id)).toEqual([
                'ESAVI-INVAUT-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('an autopsy sealed by hand keeps its date and receives no new entry', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAutopsy(id);

            const sealedAt = new Date('2024-01-01T00:00:00.000Z');
            await InvestigationAutopsy.update({ deletedAt: sealedAt }, { where: { investigationId: id } });
            const methodsBefore = await autopsyMethods(id);

            await deactivate(id);

            expect((await readAutopsy(id))!.getDataValue('deletedAt')).toEqual(sealedAt);
            expect(await autopsyMethods(id)).toEqual(methodsBefore);
        });

        it('purging the investigation destroys the autopsy by Postgres cascade without erroring', async () => {
            // The purge is not blocked when the investigation has a satellite: it is the decision
            // F13 and F29 declared and F30 inherited, with the warn dump in the log as the only
            // mitigation — two lines now, one per satellite
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAutopsy(id);
            await deactivate(id);

            expect((await purge(id)).status).toBe(200);

            expect(await readAutopsy(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();
        });

        it('an investigation with source AND autopsy seals and clears both in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createSourceFor(id);
            await createAutopsy(id);

            await deactivate(id);
            expect((await readSourceRow(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await readAutopsy(id))!.getDataValue('deletedAt')).not.toBeNull();

            await activate(id);
            expect((await readSourceRow(id))!.getDataValue('deletedAt')).toBeNull();
            expect((await readAutopsy(id))!.getDataValue('deletedAt')).toBeNull();
        });
    });

    // SPEC F32 hangs the fourth of the fourteen satellites off the same three operations, and it is
    // the spec that extracted the drag itself to common/satelliteCascade.service.ts and migrated F29
    // and F30 to it. What is checked here is the effect on the medical history, seen from the side of
    // the investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationMedicalHistory.test.ts.
    // investigationMedicalHistory has no isActive column either, so what the cascades move is its
    // deletedAt. The last case is the one that matters most: the THREE satellites travel in the same
    // transaction over the same common service, so no spec may have broken the other two
    describe('the cascade over investigationMedicalHistory', () => {

        // The medical history is created through its own endpoint, which is the only way it is ever
        // born. Like the source and unlike the autopsy, it opens empty: { investigationId } is the
        // whole minimum
        const createMedicalHistory = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-medical-histories')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        const createSourceForHistory = (investigationId: string) =>
            request(app).post('/api/investigation-sources')
                .set(authHeader('USER')).send({ investigationId });

        const createAutopsyForHistory = (investigationId: string) =>
            request(app).post('/api/investigation-autopsies')
                .set(authHeader('USER'))
                .send({ investigationId, isDeath: true, deathDate: '2024-06-01' });

        const readMedicalHistory = async (id: string) =>
            await InvestigationMedicalHistory.findByPk(id, { paranoid: false });

        const medicalHistoryMethods = async (id: string): Promise<string[]> =>
            (((await readMedicalHistory(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its medical history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createMedicalHistory(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readMedicalHistory(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await medicalHistoryMethods(id)).toEqual(['ESAVI-INVMEDH-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the medical history, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createMedicalHistory(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const medicalHistory = (await readMedicalHistory(id))!;
            expect(medicalHistory.getDataValue('deletedAt')).toBeNull();
            expect(medicalHistory.getDataValue('notes')).toBe('a note');
            expect(await medicalHistoryMethods(id)).toEqual([
                'ESAVI-INVMEDH-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('purging the investigation destroys the medical history by Postgres cascade without erroring', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30 and F32 inherited, with the warn dump in the log as the only
            // mitigation — three lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createMedicalHistory(id);
            await deactivate(id);

            expect((await purge(id)).status).toBe(200);

            expect(await readMedicalHistory(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();
        });

        it('an investigation with the THREE satellites seals and clears the three in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createSourceForHistory(id);
            await createAutopsyForHistory(id);
            await createMedicalHistory(id);

            await deactivate(id);
            expect((await InvestigationSource.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await InvestigationAutopsy.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            expect((await readMedicalHistory(id))!.getDataValue('deletedAt')).not.toBeNull();

            await activate(id);
            expect((await InvestigationSource.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            expect((await InvestigationAutopsy.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            expect((await readMedicalHistory(id))!.getDataValue('deletedAt')).toBeNull();
        });
    });

    // SPEC F34 hangs the fifth of the fourteen satellites off the same three operations, and it is
    // the FOURTH consumer of common/satelliteCascade.service.ts — the file F32 extracted precisely
    // so this one would not duplicate the drag again, and which F34 consumes without modifying.
    // What is checked here is the effect on the clinical evaluation, seen from the side of the
    // investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationClinicalEvaluation.test.ts.
    // investigationClinicalEvaluation has no isActive column either, so what the cascades move is
    // its deletedAt. Its encrypted column changes nothing for the cascade — no value is read, only a
    // date is moved — but it DOES change the purge dump, and that is why the third case reads the
    // log: the other three satellites are dumped with a raw JSON.stringify of the row, and doing the
    // same here would drop the ciphertext of clinicalDetailsPersonName into esaviLog.log.
    // The last case is the one that matters most: the FOUR satellites travel in the same transaction
    // over the same common service, so no spec may have broken the other three
    describe('the cascade over investigationClinicalEvaluation', () => {

        // The clinical evaluation is created through its own endpoint, which is the only way it is
        // ever born. Like the source and the medical history, it opens empty: { investigationId } is
        // the whole minimum
        const createClinicalEvaluation = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-clinical-evaluations')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        // Where esaviLog writes. Read directly because the warn dump of the purge never reaches an
        // HTTP response: it is the only trace an irreversible cascade leaves
        const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const readClinicalEvaluation = async (id: string) =>
            await InvestigationClinicalEvaluation.findByPk(id, { paranoid: false });

        const clinicalEvaluationMethods = async (id: string): Promise<string[]> =>
            (((await readClinicalEvaluation(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its clinical evaluation', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createClinicalEvaluation(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readClinicalEvaluation(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await clinicalEvaluationMethods(id)).toEqual(['ESAVI-INVCLIEV-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the clinical evaluation, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createClinicalEvaluation(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const clinicalEvaluation = (await readClinicalEvaluation(id))!;
            expect(clinicalEvaluation.getDataValue('deletedAt')).toBeNull();
            expect(clinicalEvaluation.getDataValue('notes')).toBe('a note');
            expect(await clinicalEvaluationMethods(id)).toEqual([
                'ESAVI-INVCLIEV-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('purging the investigation destroys the clinical evaluation by Postgres cascade, dumping it without its encrypted column', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30, F32 and F34 inherited, with the warn dump in the log as the
            // only mitigation — four lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createClinicalEvaluation(id, { clinicalDetailsPersonName: 'juan carlos', notes: 'cascade dump' });
            await deactivate(id);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readClinicalEvaluation(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
            const evaluationLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('clinical evaluation'));

            // The line exists and carries the row, but not the encrypted column in ANY of its forms
            expect(evaluationLine).toBeDefined();
            expect(evaluationLine).toContain('cascade dump');
            expect(evaluationLine).not.toContain('clinicalDetailsPersonName');
            expect(evaluationLine).not.toContain('Juan Carlos');
            expect(evaluationLine).not.toContain(esaviCrypt('Juan Carlos'));
        });

        it('an investigation with the FOUR satellites seals and clears the four in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-autopsies').set(authHeader('USER'))
                .send({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await request(app).post('/api/investigation-medical-histories').set(authHeader('USER')).send({ investigationId: id });
            await createClinicalEvaluation(id);

            const satellites = [InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory, InvestigationClinicalEvaluation];

            await deactivate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });
    });

    // SPEC F36 hangs the sixth of the fourteen satellites off the same three operations, and it is
    // the FIFTH consumer of common/satelliteCascade.service.ts, which it consumes without modifying.
    // What is checked here is the effect on the vaccination context, seen from the side of the
    // investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationVaccinationContext.test.ts.
    // investigationVaccinationContext has no isActive column either, so what the cascades move is
    // its deletedAt. Unlike investigationClinicalEvaluation it carries no encrypted column, so its
    // purge dump is a raw JSON.stringify of the whole row and there is nothing to omit.
    // The last case is the one that matters most: the FIVE satellites travel in the same transaction
    // over the same common service, so no spec may have broken the other four
    describe('the cascade over investigationVaccinationContext', () => {

        // The vaccination context is created through its own endpoint, which is the only way it is
        // ever born. Like the source, the medical history and the clinical evaluation, it opens
        // empty: { investigationId } is the whole minimum
        const createVaccinationContext = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-vaccination-contexts')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const readVaccinationContext = async (id: string) =>
            await InvestigationVaccinationContext.findByPk(id, { paranoid: false });

        const vaccinationContextMethods = async (id: string): Promise<string[]> =>
            (((await readVaccinationContext(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its vaccination context', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createVaccinationContext(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readVaccinationContext(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await vaccinationContextMethods(id)).toEqual(['ESAVI-INVVACTX-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the vaccination context, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createVaccinationContext(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const context = (await readVaccinationContext(id))!;
            expect(context.getDataValue('deletedAt')).toBeNull();
            expect(context.getDataValue('notes')).toBe('a note');
            expect(await vaccinationContextMethods(id)).toEqual([
                'ESAVI-INVVACTX-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('a row sealed by hand BEFORE the cascade keeps its original deletedAt and gets no new entry', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createVaccinationContext(id);

            const sealedAt = new Date('2024-01-15T10:00:00.000Z');
            await InvestigationVaccinationContext.update({ deletedAt: sealedAt }, { where: { investigationId: id } });

            await deactivate(id);

            const context = (await readVaccinationContext(id))!;
            expect(new Date(context.getDataValue('deletedAt') as Date).toISOString()).toBe(sealedAt.toISOString());
            expect(await vaccinationContextMethods(id)).toEqual(['ESAVI-INVVACTX-001']);
        });

        it('an investigation with no vaccination context deactivates and reactivates without error', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            expect((await deactivate(id)).status).toBe(200);
            expect((await activate(id)).status).toBe(200);
        });

        it('purging the investigation destroys the vaccination context by Postgres cascade, dumping the whole row', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30, F32, F34 and F36 inherited, with the warn dump in the log as
            // the only mitigation - five lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createVaccinationContext(id, { locations: 'cascade dump probe', vaccinatedPerVialCount: 0 });
            await deactivate(id);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readVaccinationContext(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
            const contextLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('vaccination context'));

            expect(contextLine).toBeDefined();
            expect(contextLine).toContain('cascade dump probe');
        });

        it('an investigation with the FIVE satellites without isActive seals and clears the five in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-autopsies').set(authHeader('USER'))
                .send({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await request(app).post('/api/investigation-medical-histories').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-clinical-evaluations').set(authHeader('USER')).send({ investigationId: id });
            await createVaccinationContext(id);

            const satellites = [
                InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory,
                InvestigationClinicalEvaluation, InvestigationVaccinationContext
            ];

            await deactivate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });
    });

    // SPEC F38 hangs the eighth of the fourteen satellites off the same three operations, and it is
    // the SIXTH consumer of common/satelliteCascade.service.ts, which it consumes without modifying.
    // What is checked here is the effect on the cold chain, seen from the side of the investigation:
    // the detailed behaviour of the entity lives in tests/contract/investigationColdChain.test.ts.
    // investigationColdChain has no isActive column either, so what the cascades move is its
    // deletedAt. Like investigationVaccinationContext it carries no encrypted column, so its purge
    // dump is a raw JSON.stringify of the whole row and there is nothing to omit.
    // The last case is the one that matters most: the SIX satellites travel in the same transaction
    // over the same common service, so no spec may have broken the other five
    describe('the cascade over investigationColdChain', () => {

        // The cold chain is created through its own endpoint, which is the only way it is ever born.
        // Like the source, the medical history, the clinical evaluation and the vaccination context,
        // it opens empty: { investigationId } is the whole minimum
        const createColdChain = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-cold-chains')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const readColdChain = async (id: string) =>
            await InvestigationColdChain.findByPk(id, { paranoid: false });

        const coldChainMethods = async (id: string): Promise<string[]> =>
            (((await readColdChain(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its cold chain', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createColdChain(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readColdChain(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await coldChainMethods(id)).toEqual(['ESAVI-INVCOLD-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the cold chain, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createColdChain(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const coldChain = (await readColdChain(id))!;
            expect(coldChain.getDataValue('deletedAt')).toBeNull();
            expect(coldChain.getDataValue('notes')).toBe('a note');
            expect(await coldChainMethods(id)).toEqual([
                'ESAVI-INVCOLD-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('a row sealed by hand BEFORE the cascade keeps its original deletedAt and gets no new entry', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createColdChain(id);

            const sealedAt = new Date('2024-01-15T10:00:00.000Z');
            await InvestigationColdChain.update({ deletedAt: sealedAt }, { where: { investigationId: id } });

            await deactivate(id);

            const coldChain = (await readColdChain(id))!;
            expect(new Date(coldChain.getDataValue('deletedAt') as Date).toISOString()).toBe(sealedAt.toISOString());
            expect(await coldChainMethods(id)).toEqual(['ESAVI-INVCOLD-001']);
        });

        it('an investigation with no cold chain deactivates and reactivates without error', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            expect((await deactivate(id)).status).toBe(200);
            expect((await activate(id)).status).toBe(200);
        });

        it('purging the investigation destroys the cold chain by Postgres cascade, dumping the whole row', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30, F32, F34, F36 and F38 inherited, with the warn dump in the
            // log as the only mitigation - six lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createColdChain(id, { transportTypeThermo: 'cold chain dump probe', storageTemperatureMonitored: false });
            await deactivate(id);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readColdChain(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
            const coldChainLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('cold chain'));

            expect(coldChainLine).toBeDefined();
            expect(coldChainLine).toContain('cold chain dump probe');
        });

        it('an investigation with the SIX satellites without isActive seals and clears the six in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-autopsies').set(authHeader('USER'))
                .send({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await request(app).post('/api/investigation-medical-histories').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-clinical-evaluations').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-vaccination-contexts').set(authHeader('USER')).send({ investigationId: id });
            await createColdChain(id);

            const satellites = [
                InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory,
                InvestigationClinicalEvaluation, InvestigationVaccinationContext, InvestigationColdChain
            ];

            await deactivate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });
    });

    // SPEC F39 hangs the ninth of the fourteen satellites off the same three operations, and it is
    // the SEVENTH consumer of common/satelliteCascade.service.ts, which it consumes without
    // modifying. What is checked here is the effect on the administration error, seen from the side
    // of the investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationAdministrationError.test.ts.
    // investigationAdministrationError has no isActive column either, so what the cascades move is
    // its deletedAt. Like investigationColdChain it carries no encrypted column, so its purge dump
    // is a raw JSON.stringify of the whole row and there is nothing to omit.
    // The last case is the one that matters most: the SEVEN satellites travel in the same
    // transaction over the same common service, so no spec may have broken the other six
    describe('the cascade over investigationAdministrationError', () => {

        // The administration error is created through its own endpoint, which is the only way it is
        // ever born. Like the source, the medical history, the clinical evaluation, the vaccination
        // context and the cold chain, it opens empty: { investigationId } is the whole minimum
        const createAdministrationError = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-administration-errors')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        const administrationErrorLogPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const readAdministrationError = async (id: string) =>
            await InvestigationAdministrationError.findByPk(id, { paranoid: false });

        const administrationErrorMethods = async (id: string): Promise<string[]> =>
            (((await readAdministrationError(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its administration error', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createAdministrationError(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readAdministrationError(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await administrationErrorMethods(id)).toEqual(['ESAVI-INVADMER-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the administration error, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAdministrationError(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const administrationError = (await readAdministrationError(id))!;
            expect(administrationError.getDataValue('deletedAt')).toBeNull();
            expect(administrationError.getDataValue('notes')).toBe('a note');
            expect(await administrationErrorMethods(id)).toEqual([
                'ESAVI-INVADMER-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('a row sealed by hand BEFORE the cascade keeps its original deletedAt and gets no new entry', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAdministrationError(id);

            const sealedAt = new Date('2024-01-15T10:00:00.000Z');
            await InvestigationAdministrationError.update({ deletedAt: sealedAt }, { where: { investigationId: id } });

            await deactivate(id);

            const administrationError = (await readAdministrationError(id))!;
            expect(new Date(administrationError.getDataValue('deletedAt') as Date).toISOString()).toBe(sealedAt.toISOString());
            expect(await administrationErrorMethods(id)).toEqual(['ESAVI-INVADMER-001']);
        });

        it('an investigation with no administration error deactivates and reactivates without error', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            expect((await deactivate(id)).status).toBe(200);
            expect((await activate(id)).status).toBe(200);
        });

        it('purging the investigation destroys the administration error by Postgres cascade, dumping the whole row', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30, F32, F34, F36, F38 and F39 inherited, with the warn dump in
            // the log as the only mitigation - seven lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createAdministrationError(id, {
                syringesKeyFindings: 'administration error dump probe',
                hadHandlingError: 'NO'
            });
            await deactivate(id);

            const logBefore = fs.existsSync(administrationErrorLogPath)
                ? fs.readFileSync(administrationErrorLogPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readAdministrationError(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(administrationErrorLogPath, 'utf-8').slice(logBefore);
            const administrationErrorLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('administration error'));

            expect(administrationErrorLine).toBeDefined();
            expect(administrationErrorLine).toContain('administration error dump probe');
        });

        it('an investigation with the SEVEN satellites without isActive seals and clears the seven in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-autopsies').set(authHeader('USER'))
                .send({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await request(app).post('/api/investigation-medical-histories').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-clinical-evaluations').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-vaccination-contexts').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-cold-chains').set(authHeader('USER')).send({ investigationId: id });
            await createAdministrationError(id);

            const satellites = [
                InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory,
                InvestigationClinicalEvaluation, InvestigationVaccinationContext, InvestigationColdChain,
                InvestigationAdministrationError
            ];

            await deactivate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });
    });

    // SPEC F40 hangs the tenth of the fourteen satellites off the same three operations, and it is
    // the EIGHTH consumer of common/satelliteCascade.service.ts, which it consumes without
    // modifying. What is checked here is the effect on the community record, seen from the side of
    // the investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationCommunity.test.ts.
    // investigationCommunity has no isActive column either, so what the cascades move is its
    // deletedAt. Like investigationColdChain and investigationAdministrationError it carries no
    // encrypted column, so its purge dump is a raw JSON.stringify of the whole row — and that dump
    // now carries THE HOME COORDINATES OF THE PATIENT, which is the risk SPEC F40 §7 declares.
    // The last case is the one that matters most: the EIGHT satellites travel in the same
    // transaction over the same common service, so no spec may have broken the other seven
    describe('the cascade over investigationCommunity', () => {

        // The community record is created through its own endpoint, which is the only way it is ever
        // born. Like the six satellites before it, it opens empty: { investigationId } is the whole
        // minimum
        const createCommunity = (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-communities')
                .set(authHeader('USER'))
                .send({ investigationId, ...payload });

        const communityLogPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');

        const readCommunity = async (id: string) =>
            await InvestigationCommunity.findByPk(id, { paranoid: false });

        const communityMethods = async (id: string): Promise<string[]> =>
            (((await readCommunity(id))!.getDataValue('appDetails') as { method: string }[]) ?? [])
                .map(entry => entry.method);

        it('deactivating the investigation seals its community record', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            expect((await createCommunity(id, { notes: 'a note' })).status).toBe(201);

            expect((await deactivate(id)).status).toBe(200);

            expect((await readCommunity(id))!.getDataValue('deletedAt')).not.toBeNull();
            expect(await communityMethods(id)).toEqual(['ESAVI-INVCOMM-001', 'ESAVI-INVESTGN-005A']);
        });

        it('reactivating it returns the community record, keeping the previous history', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createCommunity(id, { notes: 'a note' });
            await deactivate(id);

            expect((await activate(id)).status).toBe(200);

            const community = (await readCommunity(id))!;
            expect(community.getDataValue('deletedAt')).toBeNull();
            expect(community.getDataValue('notes')).toBe('a note');
            expect(await communityMethods(id)).toEqual([
                'ESAVI-INVCOMM-001', 'ESAVI-INVESTGN-005A', 'ESAVI-INVESTGN-005B'
            ]);
        });

        it('a row sealed by hand BEFORE the cascade keeps its original deletedAt and gets no new entry', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createCommunity(id);

            const sealedAt = new Date('2024-01-15T10:00:00.000Z');
            await InvestigationCommunity.update({ deletedAt: sealedAt }, { where: { investigationId: id } });

            await deactivate(id);

            const community = (await readCommunity(id))!;
            expect(new Date(community.getDataValue('deletedAt') as Date).toISOString()).toBe(sealedAt.toISOString());
            expect(await communityMethods(id)).toEqual(['ESAVI-INVCOMM-001']);
        });

        it('an investigation with no community record deactivates and reactivates without error', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;

            expect((await deactivate(id)).status).toBe(200);
            expect((await activate(id)).status).toBe(200);
        });

        it('purging the investigation destroys the community record by Postgres cascade, dumping the whole row', async () => {
            // The purge is not blocked when the investigation has satellites: it is the decision F13
            // and F29 declared and F30, F32, F34, F36, F38, F39 and F40 inherited, with the warn dump
            // in the log as the only mitigation - eight lines now, one per satellite without isActive
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await createCommunity(id, {
                notes: 'community dump probe',
                patientLatitude: -0.3306532
            });
            await deactivate(id);

            const logBefore = fs.existsSync(communityLogPath)
                ? fs.readFileSync(communityLogPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readCommunity(id)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(communityLogPath, 'utf-8').slice(logBefore);
            const communityLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('community record'));

            expect(communityLine).toBeDefined();
            expect(communityLine).toContain('community dump probe');
        });

        it('an investigation with the EIGHT satellites without isActive seals and clears the eight in the same transaction', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            await request(app).post('/api/investigation-sources').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-autopsies').set(authHeader('USER'))
                .send({ investigationId: id, isDeath: true, deathDate: '2024-06-01' });
            await request(app).post('/api/investigation-medical-histories').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-clinical-evaluations').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-vaccination-contexts').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-cold-chains').set(authHeader('USER')).send({ investigationId: id });
            await request(app).post('/api/investigation-administration-errors').set(authHeader('USER')).send({ investigationId: id });
            await createCommunity(id);

            const satellites = [
                InvestigationSource, InvestigationAutopsy, InvestigationMedicalHistory,
                InvestigationClinicalEvaluation, InvestigationVaccinationContext, InvestigationColdChain,
                InvestigationAdministrationError, InvestigationCommunity
            ];

            await deactivate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).not.toBeNull();
            }

            await activate(id);
            for( const model of satellites ) {
                expect((await model.findByPk(id, { paranoid: false }))!.getDataValue('deletedAt')).toBeNull();
            }
        });
    });
    // SPEC F37 hangs the seventh of the fourteen satellites off the same three operations, and it is
    // the FIRST one since F31 that is deliberately left OUT of common/satelliteCascade.service.ts.
    // What is checked here is the effect on the administered vaccines, seen from the side of the
    // investigation: the detailed behaviour of the entity lives in
    // tests/contract/investigationVaccineAdministered.test.ts.
    // investigationVaccineAdministered DOES have an isActive column, and that is the whole point of
    // these three cases: investigation.service.ts leaves the satellites with state of their own out
    // of the cascadeSealSatellite loop, so deactivating and reactivating the investigation must not
    // move a single one of their columns. Their visibility is inherited through the include of every
    // read, never written into the row. Only the physical purge reaches them, and it does so through
    // the ON DELETE CASCADE of Postgres and not through any service
    describe('the cascade over investigationVaccineAdministered', () => {

        const logPath = path.join(process.cwd(), 'src', 'logs', 'esaviLog.log');
        let whodrugCounter = 0;

        const createWhodrug = async (): Promise<string> => {
            whodrugCounter += 1;
            return (await VaccineWhodrug.create({
                drugCode: `INVCASC${ whodrugCounter }${ Date.now().toString(36).toUpperCase() }`,
                drugName: `Cascade vaccine ${ whodrugCounter }`,
                isActive: true
            })).getDataValue('vaccineWhodrugId');
        };

        const createVaccineAdministered = async (investigationId: string, payload: Record<string, unknown> = {}) =>
            request(app).post('/api/investigation-vaccines-administered')
                .set(authHeader('USER'))
                .send({ investigationId, vaccineWhodrugId: await createWhodrug(), ...payload });

        const readVaccine = (id: string) =>
            InvestigationVaccineAdministered.findByPk(id, { paranoid: false });

        it('deactivating the investigation does NOT touch its administered vaccines', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            const vaccine = await createVaccineAdministered(id, { doseNumber: 1, notes: 'untouched' });
            expect(vaccine.status).toBe(201);
            const vaccineId = vaccine.body.data.vaccineAdministeredId;

            const before = (await readVaccine(vaccineId))!.get({ plain: true }) as Record<string, unknown>;

            expect((await deactivate(id)).status).toBe(200);

            const after = (await readVaccine(vaccineId))!.get({ plain: true }) as Record<string, unknown>;
            expect(after.isActive).toBe(true);
            expect(after.deletedAt).toBeNull();
            expect(after.sortOrder).toBe(before.sortOrder);
            expect(after.updatedAt).toEqual(before.updatedAt);
            expect(after.appDetails).toEqual(before.appDetails);
        });

        it('reactivating it does not touch them either', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            const vaccineId = (await createVaccineAdministered(id, { notes: 'still untouched' })).body.data.vaccineAdministeredId;

            await deactivate(id);
            const before = (await readVaccine(vaccineId))!.get({ plain: true }) as Record<string, unknown>;

            expect((await activate(id)).status).toBe(200);

            const after = (await readVaccine(vaccineId))!.get({ plain: true }) as Record<string, unknown>;
            expect(after.isActive).toBe(true);
            expect(after.deletedAt).toBeNull();
            expect(after.notes).toBe('still untouched');
            expect(after.updatedAt).toEqual(before.updatedAt);
            // No ESAVI-INVESTGN-005A or 005B entry ever lands here, unlike the five satellites
            // without isActive
            expect((after.appDetails as { method: string }[]).map(entry => entry.method))
                .toEqual(['ESAVI-INVVACAD-001']);
        });

        it('purging the investigation destroys the administered vaccines by Postgres cascade without erroring', async () => {
            const created = await createInvestigation({ caseId: await createCaseFixture() });
            const id = created.body.data.investigationId;
            const first = await createVaccineAdministered(id, { doseNumber: 1 });
            const second = await createVaccineAdministered(id, { doseNumber: 2 });

            // One of the two retired: the count of the dump uses paranoid false, because the cascade
            // destroys the sealed ones all the same
            await request(app).delete(`/api/investigation-vaccines-administered/${ second.body.data.vaccineAdministeredId }`)
                .set(authHeader('ADMIN'));

            await deactivate(id);

            const logBefore = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').length : 0;

            expect((await purge(id)).status).toBe(200);

            expect(await readVaccine(first.body.data.vaccineAdministeredId)).toBeNull();
            expect(await readVaccine(second.body.data.vaccineAdministeredId)).toBeNull();
            expect(await Investigation.findByPk(id, { paranoid: false })).toBeNull();

            // log4js buffers, so give the appender a tick to flush
            await new Promise(resolve => setTimeout(resolve, 250));
            const added = fs.readFileSync(logPath, 'utf-8').slice(logBefore);
            const vaccineLine = added.split('\n')
                .find(line => line.includes('ESAVI-INVESTGN-005C') && line.includes('vaccine(s) administered'));

            expect(vaccineLine).toBeDefined();
            expect(vaccineLine).toContain('2 investigation vaccine(s) administered');
        });
    });
});
