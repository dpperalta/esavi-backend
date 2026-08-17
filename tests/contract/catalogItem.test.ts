import path from 'path';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { app } from '../../src/app';
import { CatalogItem, CatalogType } from '../../src/models';
import { closeTestDatabase } from '../setup/database';
import { seedTestUsers, authHeader } from '../setup/auth';
import { expectPutOfGetResponseWritesNothing } from '../setup/differentialUpdate';

/**
 * catalogItem has no contract suite of its own yet — SPEC F12 found the gap while migrating the
 * twelve update services to `buildDifferentialUpdate`. This file opens it with the one case the
 * spec requires, so ESAVI-CATITEM-004 is covered where its full walkthrough will later live.
 * The rest of the CRUD belongs to the functional spec of the entity, when it is written.
 */
describe('catalogItem contract', () => {

    const suffix = Date.now().toString(36).toUpperCase();

    let catalogTypeId: string;

    beforeAll(async () => {
        await seedTestUsers();

        const catalogType = await request(app)
            .post('/api/catalog-types')
            .set(authHeader('SUPERADMIN'))
            .send({ code: `differentialItem${ suffix }`, name: `Differential Item ${ suffix }` });

        expect(catalogType.status).toBe(201);
        catalogTypeId = catalogType.body.data.catalogTypeId;
    });

    afterAll(async () => {
        await closeTestDatabase();
    });

    describe('differential update — SPEC F12', () => {

        it('a PUT resending the whole GET response writes nothing', async () => {
            const created = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({
                    catalogTypeId,
                    name: `differential ${ suffix }`,
                    value: 'DIFFERENTIAL',
                    description: 'Catalog item of the differential update case',
                    metadata: { source: 'SPEC F12' },
                    sortOrder: 1
                });

            expect(created.status).toBe(201);

            await expectPutOfGetResponseWritesNothing({
                path: '/api/catalog-items',
                id: created.body.data.catalogItemId,
                model: CatalogItem,
                role: 'SUPERADMIN'
            });
        });

    });

    /**
     * The code is minted from the name and never sent by the client, so the same name produces the
     * same code whichever door it comes through — the 001, the 004 or the 006.
     */
    describe('code minted from the name', () => {

        // Digits only: toTitleCase lowercases everything after the first letter of each word, so a
        // suffix carrying letters would come back mangled and the expectations would read as noise.
        // The catalogType of this block is created fresh for the run anyway
        const tag = Date.now().toString().slice(-6);

        // errorHandler logs every error it handles and two of these cases trigger one on purpose
        let consoleError: jest.SpyInstance;

        beforeAll(() => {
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        });

        afterAll(() => {
            consoleError.mockRestore();
        });

        it('mints the code in camelCase and ignores a code travelling in the body', async () => {
            const created = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({
                    catalogTypeId,
                    code: 'OTRA_COSA',
                    name: `Pharmaceutical form ${ tag }`,
                    value: 'PF'
                });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(`pharmaceuticalForm${ tag }`);
            expect(created.body.data.name).toBe(`Pharmaceutical Form ${ tag }`);
        });

        it('returns 409 for a name that mints a code already taken inside the same type', async () => {
            // Different case, same minted code: it is the same item, and the 409 is what says so
            const response = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({
                    catalogTypeId,
                    name: `PHARMACEUTICAL FORM ${ tag }`,
                    value: 'PF'
                });

            expect(response.status).toBe(409);
            expect(response.body.code).toBe('CATITEM_001_CODE_EXISTS');
        });

        it('returns 400 when the name mints no usable code', async () => {
            const response = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({ catalogTypeId, name: '---', value: 'X' });

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('CATITEM_001_CODE_NOT_DERIVABLE');
        });

        it('mints the code again when the name changes on an update', async () => {
            const created = await request(app)
                .post('/api/catalog-items')
                .set(authHeader('SUPERADMIN'))
                .send({ catalogTypeId, name: `Renamed item ${ tag }`, value: 'R' });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(`renamedItem${ tag }`);

            const updated = await request(app)
                .put(`/api/catalog-items/${ created.body.data.catalogItemId }`)
                .set(authHeader('SUPERADMIN'))
                .send({ name: `Renamed item ${ tag } bis` });

            expect(updated.status).toBe(200);
            expect(updated.body.data.code).toBe(`renamedItem${ tag }Bis`);
        });

    });

    /**
     * Bulk import — SPEC F20, ESAVI-CATITEM-006.
     *
     * The fixture is the contract: eight data rows that put every rule of the importer on the same
     * sheet, and counters that have to close — read = inserted + invalid + duplicated. Two of its
     * rows hang from a type the file founds on the fly, which is what makes catalogTypesCreated the
     * number that matters here and not a decoration of the report.
     */
    describe('bulk import — SPEC F20', () => {

        const importPath = '/api/catalog-items/import';
        const fixture = path.resolve(__dirname, '../fixtures/catalog-items-sample.xlsx');

        // The codes the fixture carries, written in the file the way an operator would and stored the
        // way ESAVI-CATTYPE-001 would have stored them. That toCamelCase runs on both sides is what
        // makes 'tipo prueba import' resolve against the existing type instead of founding a twin
        const existingTypeCode = 'tipoPruebaImport';
        const foundedTypeCode = 'tipoNuevoImport';

        // errorHandler logs every error it handles and two of these cases trigger one on purpose
        let consoleError: jest.SpyInstance;

        const importFixture = ( role: 'SUPERADMIN' | 'ADMIN' = 'SUPERADMIN', dryRun?: boolean ) => {
            const pending = request(app).post(importPath).set(authHeader(role));
            if( dryRun !== undefined ) {
                pending.field('dryRun', String(dryRun));
            }
            return pending.attach('file', fixture);
        };

        const readItem = async ( catalogTypeId: string, code: string ) => {
            const row = await CatalogItem.findOne({ where: { catalogTypeId, code } });
            return row === null ? null : {
                name: row.getDataValue('name'),
                value: row.getDataValue('value'),
                description: row.getDataValue('description'),
                sortOrder: row.getDataValue('sortOrder'),
                isActive: row.getDataValue('isActive'),
                metadata: row.getDataValue('metadata') as Record<string, unknown>,
                appDetails: row.getDataValue('appDetails') as { method: string }[],
                version: ( row.getDataValue('sysDetails') as { version?: number } ).version
            };
        };

        const typeIdOf = async ( code: string ): Promise<string> => {
            const row = await CatalogType.findOne({ where: { code } });
            return row!.getDataValue('catalogTypeId');
        };

        beforeAll(async () => {
            consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
            // The type four of the eight rows hang from. Created through the CRUD and not by hand, so
            // the code the importer has to resolve against is the one the 001 really mints
            const created = await request(app)
                .post('/api/catalog-types')
                .set(authHeader('SUPERADMIN'))
                .send({ code: 'tipo prueba import', name: 'Tipo Prueba Import' });

            expect(created.status).toBe(201);
            expect(created.body.data.code).toBe(existingTypeCode);
        });

        afterAll(() => {
            consoleError.mockRestore();
        });

        it('rejects an ADMIN with 403', async () => {
            const response = await importFixture('ADMIN');

            expect(response.status).toBe(403);
        });

        it('returns 400 when no file travels', async () => {
            const response = await request(app).post(importPath).set(authHeader('SUPERADMIN'));

            expect(response.status).toBe(400);
            expect(response.body).toMatchObject({ ok: false, code: 'CATITEM_006_FILE_REQUIRED' });
        });

        it('writes nothing on a dry run, in either table', async () => {
            const itemsBefore = await CatalogItem.count();
            const typesBefore = await CatalogType.count();

            const response = await importFixture('SUPERADMIN', true);

            expect(response.status).toBe(200);
            // The report is the same one the real run returns, catalogTypesCreated included: with no
            // undo and types founded on the fly, seeing that number before writing is the only net
            expect(response.body.data).toMatchObject({
                read: 8, inserted: 6, updated: 0, unchanged: 0,
                invalid: 1, duplicated: 1, catalogTypesCreated: 1, sortOrderCoerced: 1,
                dryRun: true
            });
            expect(await CatalogItem.count()).toBe(itemsBefore);
            expect(await CatalogType.count()).toBe(typesBefore);
            expect(await CatalogType.findOne({ where: { code: foundedTypeCode } })).toBeNull();
        });

        it('imports the fixture and founds the missing type once', async () => {
            const response = await importFixture();

            expect(response.status).toBe(200);
            expect(response.body.ok).toBe(true);
            // 8 = 6 + 1 + 1. The counters closing is the check, not each one on its own
            expect(response.body.data).toMatchObject({
                read: 8, inserted: 6, updated: 0, unchanged: 0,
                invalid: 1, duplicated: 1, catalogTypesCreated: 1, sortOrderCoerced: 1,
                dryRun: false, sheet: 'Items',
                missingOptionalHeaders: [], unknownHeaders: []
            });
            expect(response.body.data.errors).toEqual([
                { row: 8, reason: 'DUPLICATE_IN_FILE' },
                { row: 9, reason: 'EMPTY_CODE' }
            ]);
            expect(await CatalogType.count({ where: { code: foundedTypeCode } })).toBe(1);
        });

        it('stores the founded type with the name the file brought and its audit entry', async () => {
            const founded = await CatalogType.findOne({ where: { code: foundedTypeCode } });

            expect(founded!.getDataValue('name')).toBe('Tipo Nuevo Import');
            expect(founded!.getDataValue('isActive')).toBe(true);
            expect(( founded!.getDataValue('appDetails') as { method: string }[] )[0].method)
                .toBe('ESAVI-CATITEM-006');
        });

        it('mints the code from the name the way the 001 does, and fills an empty value with the name', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const activo = await readItem(typeId, 'activo');
            const cerrado = await readItem(typeId, 'cerrado');

            // The row is found by the code the file never brought: 'Activo' minted 'activo'
            expect(activo).toMatchObject({ name: 'Activo', value: 'A', description: 'Estado activo', sortOrder: 1 });
            // The one column that never lands null: an empty cell carries the already normalized name
            expect(cerrado).toMatchObject({ name: 'Cerrado', value: 'Cerrado', description: 'Estado cerrado' });
        });

        it('coerces an invalid sortOrder to 0 instead of losing the row', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const orden = await readItem(typeId, 'orden');

            expect(orden).toMatchObject({ name: 'Orden', sortOrder: 0 });
        });

        it('leaves every inserted row with metadata at {} and isActive true', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const activo = await readItem(typeId, 'activo');

            expect(activo!.metadata).toEqual({});
            expect(activo!.isActive).toBe(true);
            expect(activo!.appDetails).toHaveLength(1);
            expect(activo!.appDetails[0].method).toBe('ESAVI-CATITEM-006');
        });

        it('keeps the first appearance of a repeated pair and rejects the second', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const activo = await readItem(typeId, 'activo');

            // Row 8 writes the name as 'ACTIVO', which mints the same code and is therefore the same
            // pair. Its value is 'X' and must not have won over the 'A' of row 2
            expect(activo!.value).toBe('A');
            expect(activo!.name).toBe('Activo');
        });

        it('reimports the same file without writing a single row', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const before = await readItem(typeId, 'activo');

            const response = await importFixture();

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({
                read: 8, inserted: 0, updated: 0, unchanged: 6, catalogTypesCreated: 0
            });

            const after = await readItem(typeId, 'activo');
            // No UPDATE means no appDetails entry and no sysDetails event. This is the criterion that
            // really discriminates: a non-differential importer passes every test above and fails here
            expect(after!.appDetails).toHaveLength(before!.appDetails.length);
            expect(after!.version).toBe(before!.version);
        });

        it('updates only the row whose value changed', async () => {
            const typeId = await typeIdOf(existingTypeCode);
            const before = await readItem(typeId, 'vigente');

            // The same book with one cell changed, built in memory so the fixture on disk stays the
            // one the rest of the block asserts against. The cell is `value` and not `name`: the code
            // is minted from the name, so touching the name changes the identity of the row
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(fixture);
            workbook.worksheets[0].getRow(3).getCell(4).value = 'V2';
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

            const response = await request(app).post(importPath)
                .set(authHeader('SUPERADMIN'))
                .attach('file', buffer, 'catalog-items-sample.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ updated: 1, unchanged: 5, inserted: 0 });

            const after = await readItem(typeId, 'vigente');
            expect(after!.value).toBe('V2');
            expect(after!.appDetails).toHaveLength(before!.appDetails.length + 1);
            expect(after!.version).toBe(( before!.version ?? 0 ) + 1);
        });

        it('never touches an existing catalogType, however different its name in the file', async () => {
            const before = await CatalogType.findOne({ where: { code: existingTypeCode } });
            const beforeDetails = ( before!.getDataValue('appDetails') as unknown[] ).length;
            const beforeVersion = ( before!.getDataValue('sysDetails') as { version?: number } ).version;

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(fixture);
            workbook.worksheets[0].getRow(2).getCell(2).value = 'Un Nombre Totalmente Distinto';
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

            const response = await request(app).post(importPath)
                .set(authHeader('SUPERADMIN'))
                .attach('file', buffer, 'catalog-items-sample.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data.catalogTypesCreated).toBe(0);

            const after = await CatalogType.findOne({ where: { code: existingTypeCode } });
            // A load of items that renamed types in silence would be the worst effect this endpoint
            // could have: the name of a type is seen by the whole application
            expect(after!.getDataValue('name')).toBe('Tipo Prueba Import');
            expect(( after!.getDataValue('appDetails') as unknown[] ).length).toBe(beforeDetails);
            expect(( after!.getDataValue('sysDetails') as { version?: number } ).version).toBe(beforeVersion);
        });

        it('does not reactivate an item deactivated with the 005A', async () => {
            const typeId = await typeIdOf(foundedTypeCode);
            const target = await CatalogItem.findOne({ where: { catalogTypeId: typeId, code: 'leve' } });

            const deleted = await request(app)
                .delete(`/api/catalog-items/${ target!.getDataValue('catalogItemId') }`)
                .set(authHeader('ADMIN'));
            expect(deleted.status).toBe(200);

            const response = await importFixture();
            expect(response.status).toBe(200);

            const after = await CatalogItem.findByPk(target!.getDataValue('catalogItemId'));
            // The file declares no currency, so inferring one from it would be inventing it
            expect(after!.getDataValue('isActive')).toBe(false);
            expect(after!.getDataValue('deletedAt')).not.toBeNull();
        });

        // The consequence of minting the code from the name: the name is the identity of an item
        // inside its type, so the importer cannot rename. A changed name is a different pair, which
        // is an insertion, and the old row stays where it was — renaming is the 004's business
        it('inserts a new item when the name changes, instead of renaming the existing one', async () => {
            const typeId = await typeIdOf(existingTypeCode);

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(fixture);
            workbook.worksheets[0].getRow(3).getCell(3).value = 'Vigente Renombrado';
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

            const response = await request(app).post(importPath)
                .set(authHeader('SUPERADMIN'))
                .attach('file', buffer, 'catalog-items-sample.xlsx');

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ inserted: 1 });
            expect(await readItem(typeId, 'vigenteRenombrado')).toMatchObject({ name: 'Vigente Renombrado' });
            expect(await readItem(typeId, 'vigente')).not.toBeNull();
        });

        it('returns 400 CATITEM_006_FILE_INVALID for a book that is not a workbook', async () => {
            const response = await request(app).post(importPath)
                .set(authHeader('SUPERADMIN'))
                .attach('file', Buffer.from('esto no es un libro'), 'catalog-items-sample.xlsx');

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('CATITEM_006_FILE_INVALID');
        });

        it('returns 400 CATITEM_006_FILE_INVALID when a required header is missing', async () => {
            const itemsBefore = await CatalogItem.count();
            const typesBefore = await CatalogType.count();

            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Items');
            worksheet.addRow([ 'catalogTypeCode', 'catalogTypeName', 'value' ]);
            worksheet.addRow([ 'tipo sin name', 'Tipo Sin Name', 'Uno' ]);
            const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

            const response = await request(app).post(importPath)
                .set(authHeader('SUPERADMIN'))
                .attach('file', buffer, 'sin-name.xlsx');

            expect(response.status).toBe(400);
            expect(response.body.code).toBe('CATITEM_006_FILE_INVALID');
            // The cut happens before a single data row is read, so neither table grew
            expect(await CatalogItem.count()).toBe(itemsBefore);
            expect(await CatalogType.count()).toBe(typesBefore);
        });

    });

});
