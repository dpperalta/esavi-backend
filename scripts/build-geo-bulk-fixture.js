/**
 * Builds tests/fixtures/geo-bulk-sample.xlsx, the fixture of SPEC F53 §4 step 13.
 *
 * Run with `node scripts/build-geo-bulk-fixture.js`. The generated file is versioned; this script
 * exists so the twelve rows of sheet 1 and the four of sheet 2 can be read as source instead of
 * having to be opened in Excel to know what they carry.
 *
 * Sheet geoLocation — 12 rows: seven valid across four levels (one of them with sortOrder 'abc'),
 * one repeated externalCode, one with a name over 200 characters, a child of that same row, one
 * with a parentCode that does not exist, and a child of that last one.
 * The rows are deliberately OUT OF ORDER: the parish comes before its canton, which is what proves
 * the order inside the sheet is irrelevant.
 *
 * Sheet healthFacility — 4 rows: two valid, the second hanging from the first by parentLocalCode,
 * one with a facilityTypeCode that does not exist and one with a geoExternalCode that does not.
 *
 * Expected report: geoLocation { read: 12, inserted: 7, duplicated: 1, invalid: 4,
 * sortOrderCoerced: 1 } and healthFacility { read: 4, inserted: 2, invalid: 2 } — 12 = 7 + 1 + 4
 * and 4 = 2 + 2.
 */
const ExcelJS = require('exceljs');
const path = require('path');

const GEO_HEADER = [
    'externalCode', 'name', 'level', 'parentCode', 'officialName',
    'shortName', 'isoCode', 'latitude', 'longitude', 'sortOrder'
];

const FACILITY_HEADER = [
    'localCode', 'name', 'geoExternalCode', 'facilityTypeCode', 'officialName', 'shortName',
    'address', 'latitude', 'longitude', 'phone', 'email', 'parentLocalCode'
];

const LONG_NAME = 'X'.repeat(201);

const GEO_ROWS = [
    // valid, level 1
    [ 'F53-EC', 'Ecuador F53', 1, null, 'Republica del Ecuador F53', 'ECU', 'EC', -1.8312, -78.1834, 1 ],
    // valid, level 3 — written BEFORE its level-2 parent on purpose
    [ 'F53-QUI', 'Quito F53', 3, 'F53-PIC', null, null, null, -0.2299, -78.5249, 2 ],
    // valid, level 2
    [ 'F53-PIC', 'Pichincha F53', 2, 'F53-EC', 'Provincia de Pichincha F53', 'PIC', null, null, null, 1 ],
    // rejected: VALUE_TOO_LONG on name, level 2
    [ 'F53-LONG', LONG_NAME, 2, 'F53-EC', null, null, null, null, null, 1 ],
    // rejected: ORPHAN — child of the row above
    [ 'F53-LONGC', 'Hija de la fila larga F53', 3, 'F53-LONG', null, null, null, null, null, 1 ],
    // valid, level 4 — sortOrder 'abc' is coerced to 0 and counted, and never rejects
    [ 'F53-CEN', 'Centro Historico F53', 4, 'F53-QUI', null, null, null, null, null, 'abc' ],
    // rejected: PARENT_NOT_FOUND — the code is in neither the file nor the base
    [ 'F53-HUER', 'Sin padre F53', 2, 'F53-NO-EXISTE', null, null, null, null, null, 1 ],
    // valid, level 2
    [ 'F53-GUA', 'Guayas F53', 2, 'F53-EC', null, null, null, null, null, 2 ],
    // rejected: ORPHAN — child of the PARENT_NOT_FOUND row
    [ 'F53-HUERC', 'Hija de la sin padre F53', 3, 'F53-HUER', null, null, null, null, null, 1 ],
    // valid, level 3
    [ 'F53-GYE', 'Guayaquil F53', 3, 'F53-GUA', null, null, null, null, null, 1 ],
    // rejected: DUPLICATE_IN_FILE — F53-GYE already appeared above and that first one wins
    [ 'F53-GYE', 'Guayaquil Repetido F53', 3, 'F53-GUA', null, null, null, null, null, 9 ],
    // valid, level 4
    [ 'F53-TAR', 'Tarqui F53', 4, 'F53-GYE', null, null, null, null, null, 1 ]
];

const FACILITY_ROWS = [
    // valid, no parent
    [ 'F53_HOSP_CENTRAL', 'hospital central f53', 'F53-QUI', 'HOSPITAL', null, null,
        'Av. Central 100', null, null, '022222222', 'central.f53@test.local', null ],
    // valid, hanging from the row above — and written after it so the iterative pass has something
    // to resolve in a second turn
    [ 'F53_HOSP_ANEXO', 'anexo del hospital central f53', 'F53-QUI', 'HOSPITAL', null, null,
        'Av. Central 102', null, null, null, null, 'F53_HOSP_CENTRAL' ],
    // rejected: FACILITY_TYPE_NOT_FOUND
    [ 'F53_TIPO_MALO', 'tipo inexistente f53', 'F53-QUI', 'NO_EXISTE_ESTE_TIPO', null, null,
        null, null, null, null, null, null ],
    // rejected: GEO_NOT_FOUND
    [ 'F53_GEO_MALA', 'geo inexistente f53', 'F53-NO-EXISTE-TAMPOCO', 'HOSPITAL', null, null,
        null, null, null, null, null, null ]
];

// The catalogs sheet, generated the way ESAVI-GEOLOC-007 generates it. The importer never reads it:
// it is here so the fixture is a book of three sheets, like the real ones
const CATALOG_ROWS = [
    [ 1, 'Pais', null, 'HOSPITAL', 'Hospital' ],
    [ 2, 'Provincia', null, 'HEALTH_CENTER', 'Health center' ],
    [ 3, 'Canton', null, 'CLINIC', 'Clinic' ],
    [ 4, 'Parroquia', null, 'LABORATORY', 'Laboratory' ]
];

const build = async () => {
    const workbook = new ExcelJS.Workbook();

    const geoSheet = workbook.addWorksheet('geoLocation');
    geoSheet.addRow(GEO_HEADER);
    GEO_ROWS.forEach(( row ) => geoSheet.addRow(row));

    const facilitySheet = workbook.addWorksheet('healthFacility');
    facilitySheet.addRow(FACILITY_HEADER);
    FACILITY_ROWS.forEach(( row ) => facilitySheet.addRow(row));

    const catalogsSheet = workbook.addWorksheet('catalogs');
    catalogsSheet.addRow([ 'level', 'name', null, 'code', 'name' ]);
    CATALOG_ROWS.forEach(( row ) => catalogsSheet.addRow(row));

    const target = path.join(__dirname, '..', 'tests', 'fixtures', 'geo-bulk-sample.xlsx');
    await workbook.xlsx.writeFile(target);
    console.log(`Written ${ target } — ${ GEO_ROWS.length } geoLocation rows, ${ FACILITY_ROWS.length } healthFacility rows`);
};

build();
