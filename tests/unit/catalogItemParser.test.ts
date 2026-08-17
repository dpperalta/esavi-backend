import ExcelJS from 'exceljs';

import { parseCatalogItemsXlsxFile } from '../../src/helpers/catalogItemParser.helper';

// The parser of ESAVI-CATITEM-006 is a pure function, so it is covered here over books built in
// memory instead of over HTTP: what is under test is the reading of a sheet, not an endpoint, and
// every case below would otherwise cost a fixture file and a round trip through the database.
// The contract suite covers the endpoint; this one covers the six headers and the rules

const FULL_HEADER = [ 'catalogTypeCode', 'catalogTypeName', 'name', 'value', 'description', 'sortOrder' ];

/**
 * Builds an .xlsx in memory. A cell passed as undefined is left empty, which is the only way to test
 * the difference between an empty cell and one carrying an empty string.
 */
const buildWorkbook = async ( header: string[], rows: ( string | number | undefined )[][], sheetName = 'Items' ): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(sheetName);

    worksheet.addRow(header);
    rows.forEach(( row ) => worksheet.addRow(row));

    return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('parseCatalogItemsXlsxFile', () => {

    describe('header', () => {

        it('reads the first sheet and returns its name', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [ [ 'tipoEvento', 'Tipo Evento', 'Activo' ] ], 'Catalogo');
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.sheet).toBe('Catalogo');
            expect(parsed.rows).toHaveLength(1);
        });

        it('stops before reading a single data row when a required header is missing', async () => {
            // The whole point of cutting here is that nothing is written in either table
            const buffer = await buildWorkbook(
                [ 'catalogTypeCode', 'catalogTypeName', 'value' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'A' ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.missingRequiredHeaders).toEqual([ 'name' ]);
            expect(parsed.rows).toHaveLength(0);
            expect(parsed.rejected).toHaveLength(0);
        });

        it('matches headers ignoring case, spaces, dashes and underscores', async () => {
            const buffer = await buildWorkbook(
                [ 'Catalog Type Code', 'catalog_type_name', 'Name', 'sort-order' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'Activo', 3 ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.missingRequiredHeaders).toHaveLength(0);
            expect(parsed.unknownHeaders).toHaveLength(0);
            expect(parsed.rows[0].values.sortOrder).toBe(3);
        });

        it('reports an absent optional header and leaves its column at null, or 0 for sortOrder', async () => {
            const buffer = await buildWorkbook(
                [ 'catalogTypeCode', 'catalogTypeName', 'name', 'value' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'Activo', 'A' ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.missingOptionalHeaders).toEqual([ 'description', 'sortOrder' ]);
            expect(parsed.rows[0].values.description).toBeNull();
            expect(parsed.rows[0].values.sortOrder).toBe(0);
        });

        it('ignores an unknown header and reports it instead of failing', async () => {
            const buffer = await buildWorkbook(
                [ ...FULL_HEADER, 'observaciones' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'Activo', 'A', 'D', 1, 'lo que sea' ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.unknownHeaders).toEqual([ 'observaciones' ]);
            expect(parsed.rows).toHaveLength(1);
        });

        // The header of the previous version of this importer. A file authored against it still
        // loads, and the column it no longer has a destination for is ignored — but never in silence
        it('treats a code column as unknown: the code is minted from the name and not read', async () => {
            const buffer = await buildWorkbook(
                [ 'catalogTypeCode', 'catalogTypeName', 'code', 'name' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'OTRA_COSA', 'Activo' ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.unknownHeaders).toEqual([ 'code' ]);
            expect(parsed.missingRequiredHeaders).toHaveLength(0);
            expect(parsed.rows[0].code).toBe('activo');
        });

        it('rejects a buffer that is not a .xlsx workbook', async () => {
            await expect(parseCatalogItemsXlsxFile(Buffer.from('esto no es un libro')))
                .rejects.toThrow('The uploaded file could not be read as a .xlsx workbook');
        });

    });

    describe('normalization', () => {

        // The divergence that separates this importer from the two before it: it normalizes on
        // write, and the code of an item is not a column of the sheet but the camelCase of its name
        it('mints the code out of the name, whatever case the cell was written in', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'formaFarmaceutica', 'Forma Farmaceutica', 'Pharmaceutical form' ],
                [ 'formaFarmaceutica', 'Forma Farmaceutica', 'pharmaceutical FORM 2' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].code).toBe('pharmaceuticalForm');
            expect(parsed.rows[0].name).toBe('Pharmaceutical Form');
            // toTitleCase runs before toCamelCase, so the case of the cell cannot mint two codes for
            // what is the same name once stored
            expect(parsed.rows[1].code).toBe('pharmaceuticalForm2');
            expect(parsed.rows[1].name).toBe('Pharmaceutical Form 2');
        });

        it('applies toCamelCase to catalogTypeCode and toTitleCase to both names', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [ [ 'tipo evento', 'tipo evento', 'tipo evento' ] ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].catalogTypeCode).toBe('tipoEvento');
            expect(parsed.rows[0].name).toBe('Tipo Evento');
            expect(parsed.rows[0].catalogTypeName).toBe('Tipo Evento');
        });

        // toCamelCase lowercases the first word whole, so an already-camelCase cell comes out
        // flattened. It is not this importer's behaviour to fix: ESAVI-CATTYPE-001 does exactly the
        // same to the same input, and the whole point of reusing the helper is that a file resolves
        // against the type the CRUD would have created
        it('flattens an already-camelCase catalogTypeCode, the same way ESAVI-CATTYPE-001 does', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [ [ 'tipoEvento', 'Tipo Evento', 'Activo' ] ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].catalogTypeCode).toBe('tipoevento');
        });

        it('trims value and description without normalizing them', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', '  valor CRUDO  ', '  Una descripción  ' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].values.value).toBe('valor CRUDO');
            expect(parsed.rows[0].values.description).toBe('Una descripción');
        });

        it('reads an empty cell as null and never as an empty string', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', 'A', '   ' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].values.description).toBeNull();
        });

        // The only column that never enters null: the model declares it allowNull: false while the
        // DDL admits null, so an empty cell would insert fine and 500 on the update that empties it
        it('fills an empty value with an exact copy of the already normalized name', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', '  ACTIVO simple  ', undefined ],
                [ 'tipoEvento', 'Tipo Evento', 'Vigente', '   ' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].name).toBe('Activo Simple');
            expect(parsed.rows[0].values.value).toBe('Activo Simple');
            expect(parsed.rows[1].values.value).toBe('Vigente');
        });

        it('keeps the value cell when it carries text, without copying the name over it', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', 'A' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].values.value).toBe('A');
        });

        it('fills value with the name when the value header is absent altogether', async () => {
            const buffer = await buildWorkbook(
                [ 'catalogTypeCode', 'catalogTypeName', 'name' ],
                [ [ 'tipoEvento', 'Tipo Evento', 'Activo' ] ]
            );
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.missingOptionalHeaders).toContain('value');
            expect(parsed.rows[0].values.value).toBe('Activo');
        });

    });

    describe('row rules', () => {

        it('accepts the same name under two different types: uniqueness is of the pair', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo' ],
                [ 'tipoVacuna', 'Tipo Vacuna', 'Activo' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(2);
            expect(parsed.rejected).toHaveLength(0);
        });

        it('rejects the second appearance of the same pair: the first one wins', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', 'A' ],
                [ 'tipoEvento', 'Tipo Evento', 'Activo', 'X' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(1);
            expect(parsed.rows[0].values.value).toBe('A');
            expect(parsed.rejected).toEqual([ { row: 3, reason: 'DUPLICATE_IN_FILE' } ]);
        });

        // The pair is compared over the minted code, so two names that only differ in case are the
        // same item: they would collide against UQ_catalogItem_type_code once stored
        it('detects the duplicate over the normalized pair, not over the raw cells', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipo evento', 'Tipo Evento', 'activo' ],
                [ 'Tipo-Evento', 'Tipo Evento', 'ACTIVO' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(1);
            expect(parsed.rejected[0].reason).toBe('DUPLICATE_IN_FILE');
        });

        it('rejects an empty catalogTypeCode or name, each with its own reason', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ undefined, 'Tipo Evento', 'Activo' ],
                [ 'tipoEvento', 'Tipo Evento', undefined ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(0);
            expect(parsed.rejected).toEqual([
                { row: 2, reason: 'EMPTY_CATALOG_TYPE_CODE' },
                { row: 3, reason: 'EMPTY_NAME' }
            ]);
        });

        // A name made only of separators passes the NOT NULL of its column and still mints nothing.
        // Two rows like it under the same type would be the same empty code
        it('rejects a name that mints no code with EMPTY_CODE', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', '---' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(0);
            expect(parsed.rejected).toEqual([ { row: 2, reason: 'EMPTY_CODE' } ]);
        });

        it('rejects a text over the limit of its column, naming the column', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'x'.repeat(251) ],
                [ 'tipoEvento', 'Tipo Evento', 'Vigente', 'v'.repeat(251) ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(0);
            expect(parsed.rejected).toEqual([
                { row: 2, reason: 'VALUE_TOO_LONG', column: 'name' },
                { row: 3, reason: 'VALUE_TOO_LONG', column: 'value' }
            ]);
        });

        // 250 for the name against 100 for the code minted from it: a legal name can mint an illegal
        // code, and then the column named is the one that really does not fit
        it('rejects a name within its limit whose minted code overflows varchar(100)', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'x'.repeat(120) ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(0);
            expect(parsed.rejected).toEqual([ { row: 2, reason: 'VALUE_TOO_LONG', column: 'code' } ]);
        });

        // 200 for catalogType.name against 250 for catalogItem.name: two tables, two limits
        it('holds catalogTypeName to 200 characters, a different limit from name', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'x'.repeat(201), 'Activo' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rejected).toEqual([ { row: 2, reason: 'VALUE_TOO_LONG', column: 'catalogTypeName' } ]);
        });

        it('skips a fully empty row: it counts neither as read nor as invalid', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo' ],
                [ undefined, undefined, undefined ],
                [ 'tipoEvento', 'Tipo Evento', 'Vigente' ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows).toHaveLength(2);
            expect(parsed.rejected).toHaveLength(0);
        });

    });

    describe('sortOrder coercion', () => {

        it.each([
            [ 'empty', undefined ],
            [ 'negative', -1 ],
            [ 'non-numeric', 'abc' ],
            [ 'above the smallint ceiling', 40000 ],
            [ 'non-integer', 1.5 ]
        ])('coerces a %s sortOrder to 0 and flags it', async ( _label, cell ) => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', undefined, undefined, cell ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rejected).toHaveLength(0);
            expect(parsed.rows[0].values.sortOrder).toBe(0);
            expect(parsed.rows[0].sortOrderCoerced).toBe(true);
        });

        // 0 is false in JavaScript and it is also the column default, which makes the copy-paste
        // failure silent twice over. An explicit 0 is a position, not a coercion
        it('keeps an explicit 0 as 0 without flagging it', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', undefined, undefined, 0 ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows[0].values.sortOrder).toBe(0);
            expect(parsed.rows[0].sortOrderCoerced).toBe(false);
        });

        it('keeps a valid sortOrder and the smallint ceiling itself', async () => {
            const buffer = await buildWorkbook(FULL_HEADER, [
                [ 'tipoEvento', 'Tipo Evento', 'Activo', undefined, undefined, 7 ],
                [ 'tipoEvento', 'Tipo Evento', 'Vigente', undefined, undefined, 32767 ]
            ]);
            const parsed = await parseCatalogItemsXlsxFile(buffer);

            expect(parsed.rows.map(( row ) => row.values.sortOrder)).toEqual([ 7, 32767 ]);
            expect(parsed.rows.every(( row ) => row.sortOrderCoerced === false)).toBe(true);
        });

    });

});
