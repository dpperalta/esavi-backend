import ExcelJS from 'exceljs';

import { CATALOGS_SHEET, GEO_LOCATION_SHEET, HEALTH_FACILITY_SHEET } from './geoImportParser.helper';

// The header of each sheet, in the order the operator reads it and in the same order the parser
// declares its aliases. Generator and parser talk about one contract, and this is the half of it
// that writes: a column added here without being added there comes back as an unknown header
const GEO_LOCATION_COLUMNS = [
    'externalCode', 'name', 'level', 'parentCode', 'officialName',
    'shortName', 'isoCode', 'latitude', 'longitude', 'sortOrder'
] as const;

const HEALTH_FACILITY_COLUMNS = [
    'localCode', 'name', 'geoExternalCode', 'facilityTypeCode', 'officialName', 'shortName',
    'address', 'latitude', 'longitude', 'phone', 'email', 'parentLocalCode'
] as const;

// The two named ranges the dropdowns point at. They are what turns a catalog code into a choice
// instead of a transcription, and their names travel into workbook.definedNames
const GEO_LEVELS_RANGE = 'GeoLevels';
const FACILITY_TYPES_RANGE = 'FacilityTypes';

// How far down the validations reach past the last dumped row. An operator who pastes 3.000 rows
// from another book loses the validation anyway — Excel discards it on paste — so this is headroom
// for the ones typed by hand, not a guarantee
const VALIDATION_HEADROOM = 2000;

// The columns the validations sit on, 1-based, derived from the two headers above so that reordering
// a column cannot leave a dropdown pointing at the wrong one
const LEVEL_COLUMN = GEO_LOCATION_COLUMNS.indexOf('level') + 1;
const SORT_ORDER_COLUMN = GEO_LOCATION_COLUMNS.indexOf('sortOrder') + 1;
const EXTERNAL_CODE_COLUMN = GEO_LOCATION_COLUMNS.indexOf('externalCode') + 1;
const GEO_EXTERNAL_CODE_COLUMN = HEALTH_FACILITY_COLUMNS.indexOf('geoExternalCode') + 1;
const FACILITY_TYPE_COLUMN = HEALTH_FACILITY_COLUMNS.indexOf('facilityTypeCode') + 1;

export interface GeoTemplateLevel {
    // geoLevelType.sortOrder, which is what the file calls level
    level: number;
    name: string;
}

export interface GeoTemplateFacilityType {
    code: string;
    name: string;
}

// One row of sheet 1 as the template writes it. parentCode is the parent's externalCode and not its
// UUID: it has to be the same value the importer reads back, or a downloaded file re-uploaded
// untouched would produce PARENT_CHANGED on every row
export interface GeoTemplateGeoRow {
    externalCode: string | null;
    name: string;
    level: number | null;
    parentCode: string | null;
    officialName: string | null;
    shortName: string | null;
    isoCode: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    sortOrder: number | null;
}

export interface GeoTemplateFacilityRow {
    localCode: string | null;
    name: string;
    geoExternalCode: string | null;
    facilityTypeCode: string | null;
    officialName: string | null;
    shortName: string | null;
    address: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    phone: string | null;
    email: string | null;
    parentLocalCode: string | null;
}

export interface GeoTemplateInput {
    levels: GeoTemplateLevel[];
    facilityTypes: GeoTemplateFacilityType[];
    // Empty unless includeExisting travelled. Only active rows reach here: what is decided is not
    // visibility but what is reimportable, and an inactive row coming back in the file would be
    // updated without being reactivated
    geoLocations: GeoTemplateGeoRow[];
    healthFacilities: GeoTemplateFacilityRow[];
}

/**
 * A DECIMAL column comes back from pg as a string — '-0.2299000' — and writing it as text would make
 * Excel show it left-aligned and the operator retype it. Written as a number it round-trips.
 */
const toCellNumber = ( value: number | string | null ): number | null => {
    if( value === null ) {
        return null;
    }

    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Builds the catalogs sheet: two blocks side by side, level|name at A:B and code|name at D:E, each
 * exposed as a named range over its first column — the one the dropdown reads.
 *
 * The sheet is never read back by the importer. It exists so the operator chooses a level and a
 * facility type instead of guessing them, and the day it were read it would start behaving as an
 * authority over the catalogs it only mirrors.
 */
const buildCatalogsSheet = (
    workbook: ExcelJS.Workbook,
    levels: GeoTemplateLevel[],
    facilityTypes: GeoTemplateFacilityType[]
): void => {
    const sheet = workbook.addWorksheet(CATALOGS_SHEET);

    sheet.getRow(1).values = [ 'level', 'name', null, 'code', 'name' ];
    sheet.getRow(1).font = { bold: true };

    levels.forEach(( level, index ) => {
        sheet.getCell(index + 2, 1).value = level.level;
        sheet.getCell(index + 2, 2).value = level.name;
    });

    facilityTypes.forEach(( type, index ) => {
        sheet.getCell(index + 2, 4).value = type.code;
        sheet.getCell(index + 2, 5).value = type.name;
    });

    sheet.getColumn(1).width = 10;
    sheet.getColumn(2).width = 30;
    sheet.getColumn(4).width = 25;
    sheet.getColumn(5).width = 30;

    // An empty catalog is not an error — blocking a load of geography because the facility catalog
    // is empty would be a false positive — so the range still exists and covers the blank row 2. The
    // dropdown then comes out empty, which is a visible fact and not a silent absence
    const lastLevelRow = Math.max(2, levels.length + 1);
    const lastTypeRow = Math.max(2, facilityTypes.length + 1);

    workbook.definedNames.add(`${ CATALOGS_SHEET }!$A$2:$A$${ lastLevelRow }`, GEO_LEVELS_RANGE);
    workbook.definedNames.add(`${ CATALOGS_SHEET }!$D$2:$D$${ lastTypeRow }`, FACILITY_TYPES_RANGE);
};

/**
 * Turns a 1-based column number into its Excel letters — 1 is A, 27 is AA. The two sheets stay well
 * inside the single-letter range today, and the loop is what keeps that from being an assumption.
 */
const columnLetter = ( column: number ): string => {
    let rest = column;
    let letters = '';

    while( rest > 0 ) {
        const remainder = ( rest - 1 ) % 26;

        letters = String.fromCharCode(65 + remainder) + letters;
        rest = Math.floor(( rest - remainder ) / 26);
    }

    return letters;
};

// exceljs 4.4.0 ships worksheet.dataValidations at runtime but does not declare it in its .d.ts,
// which only exposes the per-cell `cell.dataValidation`. Writing one cell at a time over the
// headroom of both sheets would be some 16.000 cell objects in the book for four rules, so the
// range API is used through this shape instead of paying that
interface RangeDataValidations {
    dataValidations: { add: ( range: string, validation: ExcelJS.DataValidation ) => void };
}

const addColumnValidation = (
    sheet: ExcelJS.Worksheet,
    column: number,
    lastRow: number,
    validation: ExcelJS.DataValidation
): void => {
    const letter = columnLetter(column);

    ( sheet as unknown as RangeDataValidations )
        .dataValidations.add(`${ letter }2:${ letter }${ lastRow }`, validation);
};

/**
 * Builds the .xlsx of ESAVI-GEOLOC-007: three sheets, the two named ranges and the four data
 * validations.
 *
 * Pure function: it receives the catalogs and the rows already queried and returns the buffer. It
 * does not touch the database, and the decision of which rows to dump — active only — belongs to the
 * service that calls it.
 */
export const buildGeoTemplateWorkbook = async ( input: GeoTemplateInput ): Promise<Buffer> => {
    const { levels, facilityTypes, geoLocations, healthFacilities } = input;
    const workbook = new ExcelJS.Workbook();

    const geoSheet = workbook.addWorksheet(GEO_LOCATION_SHEET);

    geoSheet.getRow(1).values = [ ...GEO_LOCATION_COLUMNS ];
    geoSheet.getRow(1).font = { bold: true };
    GEO_LOCATION_COLUMNS.forEach(( _column, index ) => {
        geoSheet.getColumn(index + 1).width = 22;
    });

    geoLocations.forEach(( row ) => {
        geoSheet.addRow([
            row.externalCode, row.name, row.level, row.parentCode, row.officialName,
            row.shortName, row.isoCode, toCellNumber(row.latitude), toCellNumber(row.longitude),
            row.sortOrder
        ]);
    });

    const facilitySheet = workbook.addWorksheet(HEALTH_FACILITY_SHEET);

    facilitySheet.getRow(1).values = [ ...HEALTH_FACILITY_COLUMNS ];
    facilitySheet.getRow(1).font = { bold: true };
    HEALTH_FACILITY_COLUMNS.forEach(( _column, index ) => {
        facilitySheet.getColumn(index + 1).width = 22;
    });

    healthFacilities.forEach(( row ) => {
        facilitySheet.addRow([
            row.localCode, row.name, row.geoExternalCode, row.facilityTypeCode, row.officialName,
            row.shortName, row.address, toCellNumber(row.latitude), toCellNumber(row.longitude),
            row.phone, row.email, row.parentLocalCode
        ]);
    });

    // The catalogs sheet goes last so the book opens on the geography, which is what gets filled in
    buildCatalogsSheet(workbook, levels, facilityTypes);

    const geoLastRow = geoLocations.length + 1 + VALIDATION_HEADROOM;
    const facilityLastRow = healthFacilities.length + 1 + VALIDATION_HEADROOM;

    // A level the file does not know resolves to no geoLevelType and rejects its row, so the list is
    // what keeps the operator from inventing one. allowBlank stays true because the server is what
    // rejects an empty cell, with EMPTY_LEVEL, and a modal from Excel would hide that reason
    addColumnValidation(geoSheet, LEVEL_COLUMN, geoLastRow, {
        type: 'list',
        allowBlank: true,
        formulae: [ GEO_LEVELS_RANGE ]
    });

    // sortOrder never rejects a row — an invalid cell is coerced to 0 and counted — so this
    // validation is there to spare the operator a coercion, not to guarantee anything
    addColumnValidation(geoSheet, SORT_ORDER_COLUMN, geoLastRow, {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        allowBlank: true,
        formulae: [ 0 ]
    });

    // parentCode carries NO list on purpose: the parent is born in this same sheet while the file is
    // being written, so the only possible list would be self-referential. Its net is the cascade
    // rejection of the 006

    addColumnValidation(facilitySheet, FACILITY_TYPE_COLUMN, facilityLastRow, {
        type: 'list',
        allowBlank: true,
        formulae: [ FACILITY_TYPES_RANGE ]
    });

    // The one list that points at another sheet of the same book instead of at a catalog: a facility
    // hangs from a geolocation that is being written right there, so the range is deliberately
    // generous and covers rows that do not exist yet
    const geoCodeLetter = columnLetter(EXTERNAL_CODE_COLUMN);

    addColumnValidation(facilitySheet, GEO_EXTERNAL_CODE_COLUMN, facilityLastRow, {
        type: 'list',
        allowBlank: true,
        formulae: [ `${ GEO_LOCATION_SHEET }!$${ geoCodeLetter }$2:$${ geoCodeLetter }$${ geoLastRow }` ]
    });

    return await workbook.xlsx.writeBuffer() as unknown as Buffer;
};
