import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../../src/app';
import { GeoLevelType, GeoLocation, HealthFacility } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * geoLocation has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-GEOLOC-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 *
 * The case matters more here than anywhere else: latitude and longitude are DECIMAL(10, 7) and
 * `pg` reads them back as strings, so before SPEC F12 every PUT resending its own coordinates
 * rewrote the row. The comparison that closed it is numeric and lives in the helper.
 */
describe('geoLocation contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    let geoLevelTypeId: string;

    beforeAll(async () => {
        await seedTestUsers();

        const geoLevelType = await request(app)
            .post('/api/geo-level-types')
            .set(authHeader('ADMIN'))
            .send({ code: `DIFFLOC${ suffix }`, name: `Differential Location ${ suffix }`, sortOrder: 1 });

        expect(geoLevelType.status).toBe(201);
        geoLevelTypeId = geoLevelType.body.data.geoLevelTypeId;
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `Differential ${ suffix }`,
                    officialName: `Differential Official ${ suffix }`,
                    shortName: `DIFF ${ suffix }`,
                    isoCode: 'EC',
                    externalCode: `DIFFLOC${ suffix }`,
                    latitude: -0.2299,
                    longitude: -78.52495,
                    sortOrder: 1
                });

            expect(created.status).toBe(201);
            // The stored value is a string and the body carried a number: the row this case
            // resends is exactly the one that used to be rewritten on every PUT
            expect(typeof created.body.data.latitude).toBe('string');

            await expectPutOfGetResponseWritesNothing({
                path: '/api/geo-locations',
                id: created.body.data.geoLocationId,
                model: GeoLocation,
                // parentGeoLocationId is optional() but not nullable in the validator, so
                // resending the null the response carries is a 400 — the same validator gap
                // healthFacility has with its own parent, and neither belongs to this spec
                strip: ['parentGeoLocationId']
            });
        });

        // The case above resends the response, where latitude is already the string `pg` gave
        // back, so a string-to-string comparison survives it. The leak only shows when the
        // client sends the number it sent on create, which is what a JSON form does
        it('a PUT resending the same latitude as a number writes nothing', async () => {
            const created = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `Decimal ${ suffix }`,
                    externalCode: `DECIMAL${ suffix }`,
                    latitude: -0.2299,
                    longitude: -78.52495
                });
            expect(created.status).toBe(201);

            const id = created.body.data.geoLocationId;
            const before = await GeoLocation.findByPk(id);

            const response = await request(app)
                .put(`/api/geo-locations/${ id }`)
                .set(authHeader('ADMIN'))
                .send({ latitude: -0.2299, longitude: -78.52495 });

            expect(response.status).toBe(200);

            const after = await GeoLocation.findByPk(id);
            expect(( after!.getDataValue('appDetails') as unknown[] ).length)
                .toBe(( before!.getDataValue('appDetails') as unknown[] ).length);
            expect(after!.getDataValue('updatedAt')).toEqual(before!.getDataValue('updatedAt'));
        });

    });

    describe('GET /api/geo-locations — name/code text filters — SPEC F50', () => {

        let parentId: string;
        let nameMatchId: string;
        let isoOnlyMatchId: string;
        let underscoreCodeId: string;

        beforeAll(async () => {
            const parent = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    name: `TextFilterParent ${ suffix }`,
                    externalCode: `TXTPARENT${ suffix }`
                });
            expect(parent.status).toBe(201);
            parentId = parent.body.data.geoLocationId;

            const nameMatch = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `Quito ${ suffix }`,
                    externalCode: `QUITO${ suffix }`
                });
            expect(nameMatch.status).toBe(201);
            nameMatchId = nameMatch.body.data.geoLocationId;

            // externalCode intentionally does not contain the search token; only isoCode does
            const isoOnlyMatch = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `NoNameMatch ${ suffix }`,
                    externalCode: `OTHERCODE${ suffix }`,
                    isoCode: `ISOTOK${ suffix }`.slice(0, 10)
                });
            expect(isoOnlyMatch.status).toBe(201);
            isoOnlyMatchId = isoOnlyMatch.body.data.geoLocationId;

            const underscoreCode = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({
                    geoLevelTypeId,
                    parentGeoLocationId: parentId,
                    name: `Underscore ${ suffix }`,
                    externalCode: `A_B${ suffix }`
                });
            expect(underscoreCode.status).toBe(201);
            underscoreCodeId = underscoreCode.body.data.geoLocationId;

            await request(app)
                .delete(`/api/geo-locations/${ isoOnlyMatchId }`)
                .set(authHeader('ADMIN'));
        });

        it('filters by partial, case-insensitive name', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`.toUpperCase(), parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).not.toContain(underscoreCodeId);
        });

        it('filters by code matching externalCode', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `QUITO${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
        });

        it('a row whose isoCode matches but whose externalCode does not still matches code=X, only visible to roles that can view inactive', async () => {
            const asSuperAdmin = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('SUPERADMIN'))
                .query({ code: `ISOTOK${ suffix }`.slice(0, 10), parentId });

            expect(asSuperAdmin.status).toBe(200);
            const superAdminIds = asSuperAdmin.body.data.rows.map((row: any) => row.geoLocationId);
            expect(superAdminIds).toContain(isoOnlyMatchId);

            const asUser = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `ISOTOK${ suffix }`.slice(0, 10), parentId });

            expect(asUser.status).toBe(200);
            const userIds = asUser.body.data.rows.map((row: any) => row.geoLocationId);
            expect(userIds).not.toContain(isoOnlyMatchId);
        });

        it('name and code combine with OR, never requiring both at once', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`, code: `A_B${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).toContain(underscoreCodeId);
        });

        it('a text filter combines with geoLevelId/parentId using AND', async () => {
            const otherLevelType = await request(app)
                .post('/api/geo-level-types')
                .set(authHeader('ADMIN'))
                .send({ code: `OTHERLVL${ suffix }`, name: `Other Level ${ suffix }`, sortOrder: 2 });
            expect(otherLevelType.status).toBe(201);

            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `quito ${ suffix }`, geoLevelId: otherLevelType.body.data.geoLevelTypeId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).not.toContain(nameMatchId);
        });

        it('no name or code returns the same result as before this spec', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).toContain(nameMatchId);
            expect(ids).toContain(underscoreCodeId);
            expect(ids).not.toContain(isoOnlyMatchId);
        });

        it('a name/code with no match responds 200 with count 0, never 404', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: `NoSuchPlaceAtAll${ suffix }`, parentId });

            expect(response.status).toBe(200);
            expect(response.body.data.count).toBe(0);
        });

        it('rejects a name longer than 200 characters', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ name: 'a'.repeat(201) });

            expect(response.status).toBe(400);
        });

        it('rejects a code longer than 100 characters', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: 'a'.repeat(101) });

            expect(response.status).toBe(400);
        });

        it('a literal underscore in code is not treated as a wildcard', async () => {
            const response = await request(app)
                .get('/api/geo-locations')
                .set(authHeader('USER'))
                .query({ code: `AXB${ suffix }`, parentId });

            expect(response.status).toBe(200);
            const ids = response.body.data.rows.map((row: any) => row.geoLocationId);
            expect(ids).not.toContain(underscoreCodeId);
        });

    });

    /**
     * SPEC F52 §1.E / §3.8 — attributes: { exclude: ['sysDetails'] } on the 002A, 002B and 003 of
     * this entity. sysDetails is internal by convention and the rest of the repository already
     * excludes it; appDetails keeps travelling
     */
    describe('sysDetails alignment — SPEC F52', () => {

        let id: string;

        beforeAll(async () => {
            const created = await request(app)
                .post('/api/geo-locations')
                .set(authHeader('ADMIN'))
                .send({ geoLevelTypeId, name: `SysDetails ${ suffix }`, externalCode: `SYSDET${ suffix }` });
            expect(created.status).toBe(201);
            id = created.body.data.geoLocationId;
        });

        it('is absent from 002A (USER, active only)', async () => {
            const response = await request(app).get('/api/geo-locations?limit=100').set(authHeader('USER'));
            expect(response.status).toBe(200);
            const row = response.body.data.rows.find((r: { geoLocationId: string }) => r.geoLocationId === id);
            expect(row).not.toHaveProperty('sysDetails');
            expect(row).toHaveProperty('appDetails');
        });

        it('is absent from 002B (SUPERADMIN, including inactive)', async () => {
            const response = await request(app).get('/api/geo-locations?limit=100').set(authHeader('SUPERADMIN'));
            expect(response.status).toBe(200);
            const row = response.body.data.rows.find((r: { geoLocationId: string }) => r.geoLocationId === id);
            expect(row).not.toHaveProperty('sysDetails');
            expect(row).toHaveProperty('appDetails');
        });

        it('is absent from 003 (get by id)', async () => {
            const response = await request(app).get(`/api/geo-locations/${ id }`).set(authHeader('USER'));
            expect(response.status).toBe(200);
            expect(response.body.data).not.toHaveProperty('sysDetails');
            expect(response.body.data).toHaveProperty('appDetails');
        });

    });

    /**
     * SPEC F53 — bulk import of geography and health facilities, ESAVI-GEOLOC-006.
     *
     * The fixture is built by `node scripts/build-geo-bulk-fixture.js`, which is where the twelve
     * rows of sheet 1 and the four of sheet 2 read as source. What this block checks is that the
     * counters CLOSE — 12 = 7 + 1 + 4 and 4 = 2 + 2 — and the three behaviours that separate this
     * importer from the three before it: the cascade, the differential update and the refusal to
     * reparent.
     *
     * The level table is taken over for the whole block and given back in the afterAll: the precheck
     * demands a contiguous series from 1, and the leftovers of other suites are not one.
     */
    describe('bulk import — SPEC F53', () => {

        const fixturePath = path.join(__dirname, '..', 'fixtures', 'geo-bulk-sample.xlsx');
        const importFile = ( role: 'SUPERADMIN' | 'ADMIN' | 'USER' = 'SUPERADMIN', dryRun?: boolean ) => {
            const call = request(app).post('/api/geo-locations/import').set(authHeader(role));
            if( dryRun !== undefined ) { call.field('dryRun', String(dryRun)); }
            return call.attach('file', fixturePath);
        };

        let levelSnapshot: { id: string; isActive: boolean }[] = [];

        beforeAll(async () => {
            const before = await GeoLevelType.findAll({ attributes: [ 'geoLevelTypeId', 'isActive' ] });
            levelSnapshot = before.map(( row ) => ({ id: row.geoLevelTypeId, isActive: row.isActive as boolean }));

            await GeoLevelType.update({ isActive: false }, { where: {} });
            for( const [ index, name ] of [ 'Pais', 'Provincia', 'Canton', 'Parroquia' ].entries() ) {
                const created = await request(app)
                    .post('/api/geo-level-types')
                    .set(authHeader('ADMIN'))
                    .send({ code: `F53L${ index + 1 }${ suffix }`, name: `${ name } ${ suffix }`, sortOrder: index + 1 });
                expect(created.status).toBe(201);
            }
        });

        afterAll(async () => {
            await GeoLevelType.update({ isActive: false }, { where: {} });
            for( const row of levelSnapshot ) {
                await GeoLevelType.update({ isActive: row.isActive }, { where: { geoLevelTypeId: row.id } });
            }
        });

        it('the fixture is versioned and not swallowed by the *.xlsx of .gitignore', () => {
            expect(fs.existsSync(fixturePath)).toBe(true);
        });

        it('an ADMIN gets 403 and a request with no file gets 400', async () => {
            expect(( await importFile('ADMIN') ).status).toBe(403);
            expect(( await importFile('USER') ).status).toBe(403);

            const noFile = await request(app).post('/api/geo-locations/import').set(authHeader('SUPERADMIN'));
            expect(noFile.status).toBe(400);
            expect(noFile.body.code).toBe('GEOLOC_006_FILE_REQUIRED');
        });

        it('dryRun leaves both tables untouched and reports what the real run would do', async () => {
            const beforeGeo = await GeoLocation.count();
            const beforeFacility = await HealthFacility.count();

            const response = await importFile('SUPERADMIN', true);
            expect(response.status).toBe(200);
            expect(response.body.data.dryRun).toBe(true);
            expect(response.body.data.geoLocation.inserted).toBe(7);
            expect(response.body.data.healthFacility.inserted).toBe(2);

            expect(await GeoLocation.count()).toBe(beforeGeo);
            expect(await HealthFacility.count()).toBe(beforeFacility);
        });

        it('the report counters close: 12 = 7 + 1 + 4 and 4 = 2 + 2', async () => {
            const response = await importFile();

            expect(response.status).toBe(200);
            const { geoLocation, healthFacility } = response.body.data;

            expect(geoLocation).toMatchObject({
                read: 12, inserted: 7, updated: 0, unchanged: 0,
                duplicated: 1, invalid: 4, inactiveMatched: 0, sortOrderCoerced: 1
            });
            expect(geoLocation.inserted + geoLocation.updated + geoLocation.unchanged
                + geoLocation.duplicated + geoLocation.invalid).toBe(geoLocation.read);

            expect(healthFacility).toMatchObject({
                read: 4, inserted: 2, updated: 0, unchanged: 0,
                duplicated: 0, invalid: 2, inactiveMatched: 0
            });
            expect(healthFacility.inserted + healthFacility.updated + healthFacility.unchanged
                + healthFacility.duplicated + healthFacility.invalid).toBe(healthFacility.read);

            expect(response.body.data.sheets).toEqual({ geoLocation: 'geoLocation', healthFacility: 'healthFacility' });
        });

        it('two of the four invalid rows of sheet 1 are ORPHAN, and the cause comes before its cascade', async () => {
            // Reimported over what the previous case already wrote: the rejections are the same, and
            // the seven valid rows now come back as unchanged
            const response = await importFile();
            const sheetOne = ( response.body.data.errors as { sheet: string; row: number; reason: string }[] )
                .filter(( error ) => error.sheet === 'geoLocation');

            expect(sheetOne.map(( error ) => `${ error.row }:${ error.reason }`)).toEqual([
                '5:VALUE_TOO_LONG', '6:ORPHAN', '8:PARENT_NOT_FOUND', '10:ORPHAN', '12:DUPLICATE_IN_FILE'
            ]);
            expect(sheetOne.filter(( error ) => error.reason === 'ORPHAN' )).toHaveLength(2);

            const sheetTwo = ( response.body.data.errors as { sheet: string; reason: string }[] )
                .filter(( error ) => error.sheet === 'healthFacility');
            expect(sheetTwo.map(( error ) => error.reason).sort())
                .toEqual([ 'FACILITY_TYPE_NOT_FOUND', 'GEO_NOT_FOUND' ]);
        });

        it('the order of the rows inside the sheet is irrelevant: the tree is complete and correct', async () => {
            const country = await GeoLocation.findOne({ where: { externalCode: 'F53-EC' } });
            const province = await GeoLocation.findOne({ where: { externalCode: 'F53-PIC' } });
            // Written in the sheet BEFORE its parent, and still hanging from it
            const canton = await GeoLocation.findOne({ where: { externalCode: 'F53-QUI' } });
            const parish = await GeoLocation.findOne({ where: { externalCode: 'F53-CEN' } });

            expect(country!.parentGeoLocationId).toBeNull();
            expect(province!.parentGeoLocationId).toBe(country!.geoLocationId);
            expect(canton!.parentGeoLocationId).toBe(province!.geoLocationId);
            expect(parish!.parentGeoLocationId).toBe(canton!.geoLocationId);
            expect(Number(parish!.level)).toBe(4);
            // sortOrder 'abc' entered as 0 and did not reject its row
            expect(Number(parish!.sortOrder)).toBe(0);

            // Neither the rejected rows nor their cascade reached the table
            for( const missing of [ 'F53-LONG', 'F53-LONGC', 'F53-HUER', 'F53-HUERC' ] ) {
                expect(await GeoLocation.findOne({ where: { externalCode: missing } })).toBeNull();
            }
            // The duplicate kept the first appearance
            const duplicated = await GeoLocation.findOne({ where: { externalCode: 'F53-GYE' } });
            expect(duplicated!.name).toBe('Guayaquil F53');

            // Sheet 2: normalized as ESAVI-HFAC-001 does, and the child hanging from the parent
            const parent = await HealthFacility.findOne({ where: { localCode: 'F53_HOSP_CENTRAL' } });
            const child = await HealthFacility.findOne({ where: { localCode: 'F53_HOSP_ANEXO' } });
            expect(parent!.name).toBe('Hospital Central F53');
            expect(child!.parentHealthFacilityId).toBe(parent!.healthFacilityId);
            expect(( parent!.getDataValue('appDetails') as { method: string }[] )[0].method).toBe('ESAVI-GEOLOC-006');
        });

        it('reimporting writes nothing: unchanged 7 and 2, and no appDetails grows', async () => {
            const before = await GeoLocation.findOne({ where: { externalCode: 'F53-EC' } });
            const appDetailsBefore = ( before!.getDataValue('appDetails') as unknown[] ).length;
            const updatedAtBefore = before!.getDataValue('updatedAt');

            const response = await importFile();

            expect(response.body.data.geoLocation).toMatchObject({ inserted: 0, updated: 0, unchanged: 7 });
            expect(response.body.data.healthFacility).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });

            const after = await GeoLocation.findOne({ where: { externalCode: 'F53-EC' } });
            expect(( after!.getDataValue('appDetails') as unknown[] ).length).toBe(appDetailsBefore);
            expect(after!.getDataValue('updatedAt')).toEqual(updatedAtBefore);
        });

        it('editing the parentCode of an existing row produces PARENT_CHANGED and leaves the parent intact', async () => {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(fixturePath);
            const sheet = workbook.getWorksheet('geoLocation')!;
            // F53-QUI is a level 3 hanging from F53-PIC; move it under F53-GUA, which is another
            // level 2, so the parent LEVEL still fits and what is left over is the move itself. A
            // move to a parent of the wrong level would read PARENT_LEVEL_MISMATCH instead, because
            // the graph is resolved before the row is compared against what is stored
            sheet.eachRow(( row, number ) => {
                if( number > 1 && row.getCell(1).value === 'F53-QUI' ) {
                    row.getCell(4).value = 'F53-GUA';
                }
            });
            const edited = await workbook.xlsx.writeBuffer() as unknown as Buffer;

            const storedParent = ( await GeoLocation.findOne({ where: { externalCode: 'F53-QUI' } }) )!.parentGeoLocationId;

            const response = await request(app)
                .post('/api/geo-locations/import')
                .set(authHeader('SUPERADMIN'))
                .attach('file', edited, 'geo-bulk-edited.xlsx');

            expect(response.status).toBe(200);
            const reasons = ( response.body.data.errors as { reason: string }[] ).map(( error ) => error.reason);
            expect(reasons).toContain('PARENT_CHANGED');

            const after = await GeoLocation.findOne({ where: { externalCode: 'F53-QUI' } });
            expect(after!.parentGeoLocationId).toBe(storedParent);
        });

    });

});
