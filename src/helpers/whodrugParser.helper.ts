import ExcelJS from 'exceljs';

import {
    ParsedVaccineWhodrugRow,
    RejectedVaccineWhodrugRow,
    VaccineWhodrugFileValues
} from '../types/vaccineWhodrug/vaccineWhodrug.types';

// Every column the WHODrug .xlsx brings, written as the export writes it, mapped to its column in
// vaccineWhodrug. Six of these do not resolve by normalization alone — 'id', 'drugRecNo+Seq01',
// 'ingredientTranslations', 'forms_medicinalProductID', 'strengths_medicinalProductID' and
// 'noDoses' differ from the column name in more than case — which is why the table is explicit and
// not a camelCase guess. The rest are here so the whole header of the file reads in one place.
const HEADER_ALIASES: Record<string, keyof VaccineWhodrugFileValues | 'externalId' | 'drugCode' | 'drugName'> = {
    'id': 'externalId',
    'drugCode': 'drugCode',
    'drugRecNo': 'drugRecNo',
    'drugRecNo+Seq01': 'drugRecNoSeq',
    'drugName': 'drugName',
    'language': 'language',
    'medicinalProductID': 'medicinalProductId',
    'atcs': 'atcs',
    'ICD11': 'icd11',
    'ICD11term': 'icd11Term',
    'abbreviation': 'abbreviation',
    'ingredient': 'ingredient',
    'ingredientTranslations': 'ingredientTranslation',
    'languageCode': 'languageCode',
    'iso3Code': 'iso3Code',
    'country_medicinalProductID': 'countryMedicinalProductId',
    'maHolders': 'maHolders',
    'maHolders_medicinalProductID': 'maHoldersMedicinalProductId',
    'form': 'form',
    'formTranslations': 'formTranslations',
    'forms_medicinalProductID': 'formMedicinalProductId',
    'strength': 'strength',
    'strengths_medicinalProductID': 'strengthMedicinalProductId',
    'noDoses': 'noDose',
    'diluent': 'diluent',
    'isGeneric': 'isGeneric',
    'isPreferred': 'isPreferred'
};

// Without these four the file is not a WHODrug dictionary and the import stops before reading a
// single data row. The first three are the key and the two de-facto NOT NULL columns; the fourth is
// the data owner's decision. What is required is that the column exists, not that it carries a value
const REQUIRED_HEADERS = [ 'id', 'drugCode', 'drugName', 'ingredientTranslations' ];

// varchar limits of the vaccineWhodrug DDL. The text columns are absent on purpose: they have no
// limit to check. Filtering here is what keeps one oversized cell from blowing up the whole batch
const MAX_LENGTHS: Record<string, number> = {
    drugCode: 250,
    drugRecNo: 50,
    drugRecNoSeq: 50,
    language: 10,
    medicinalProductId: 250,
    atcs: 250,
    icd11: 250,
    icd11Term: 500,
    abbreviation: 250,
    languageCode: 100,
    iso3Code: 250,
    countryMedicinalProductId: 250,
    maHoldersMedicinalProductId: 250,
    formMedicinalProductId: 250,
    strengthMedicinalProductId: 250
};

// The two boolean columns of the file. Named here because the parser treats them differently from
// the 25 text ones and because a copy-paste over 27 columns is exactly where they get lost
const BOOLEAN_COLUMNS = [ 'isGeneric', 'isPreferred' ];

const TRUE_VALUES = [ '1', 'TRUE', 'Y', 'YES' ];
const FALSE_VALUES = [ '0', 'FALSE', 'N', 'NO' ];

/**
 * Raised only when the book itself cannot be read: the buffer is not a valid .xlsx or it carries no
 * sheet. The service turns it into a 400, and anything else thrown by the parser stays a 500, so a
 * real defect never disguises itself as a bad file.
 */
export class WhodrugFileError extends Error {
    constructor( message: string, public readonly cause?: unknown ) {
        super(message);
        this.name = 'WhodrugFileError';
    }
}

export interface ParsedWhodrugFile {
    sheet: string;
    rows: ParsedVaccineWhodrugRow[];
    rejected: RejectedVaccineWhodrugRow[];
    // Optional headers the file does not bring: their column enters as null in every row
    missingOptionalHeaders: string[];
    // Headers with no destination: ignored, but never in silence
    unknownHeaders: string[];
    // Non-empty means the caller aborts with 400 before writing anything. rows comes back empty
    missingRequiredHeaders: string[];
}

// Lowercase and drop the separators the exports mix in the same row — the file already writes
// 'iso3Code', 'country_medicinalProductID' and 'ICD11term' side by side. Applied to both sides of
// the comparison, so 'FORMS MEDICINAL PRODUCT ID' resolves like 'forms_medicinalProductID'
const normalizeHeader = ( header: string ): string =>
    header.trim().toLowerCase().replace(/[\s\-_+]/g, '');

// The alias table, keyed by its normalized header, built once at load time
const NORMALIZED_ALIASES: Record<string, string> = Object.entries(HEADER_ALIASES)
    .reduce(( map, [ header, column ] ) => ({ ...map, [normalizeHeader(header)]: column }), {});

/**
 * A cell as text. exceljs hands back strings, numbers, booleans, dates, rich text and formula
 * results depending on how the cell was written, and the dictionary is text in all of them.
 * An empty cell becomes null, never '': a blank cell in Excel means "no data", and storing it as an
 * empty string would make a re-import see a change where there is none.
 */
const cellToText = ( value: ExcelJS.CellValue ): string | null => {
    if( value === null || value === undefined ) {
        return null;
    }

    let text: string;

    if( value instanceof Date ) {
        text = value.toISOString();
    } else if( typeof value === 'object' ) {
        if( 'richText' in value ) {
            text = value.richText.map(( part ) => part.text).join('');
        } else if( 'text' in value ) {
            text = String(value.text);
        } else if( 'result' in value ) {
            text = value.result === null || value.result === undefined ? '' : String(value.result);
        } else if( 'error' in value ) {
            text = String(value.error);
        } else {
            text = String(value);
        }
    } else {
        text = String(value);
    }

    const trimmed = text.trim();

    return trimmed.length === 0 ? null : trimmed;
};

/**
 * A cell as boolean. An unrecognized value is read as absent, which is what the caller then turns
 * into null or false depending on the column: guessing at 'X' would be worse than not having read it
 */
const cellToBoolean = ( value: ExcelJS.CellValue ): boolean | null => {
    if( typeof value === 'boolean' ) {
        return value;
    }

    const text = cellToText(value);

    if( text === null ) {
        return null;
    }

    const upper = text.toUpperCase();

    if( TRUE_VALUES.includes(upper) ) {
        return true;
    }

    if( FALSE_VALUES.includes(upper) ) {
        return false;
    }

    return null;
};

/**
 * Parses a WHODrug .xlsx dictionary — first sheet, header on row 1, data from row 2.
 * Pure function: it does not touch the database and decides nothing about what is inserted or
 * updated, which is the service's business.
 *
 * A rejected row never aborts the parse; it is counted and the file keeps going. Only two content
 * problems stop the read, and both stop it before any write: a book that cannot be opened and a
 * missing required header.
 */
export const parseWhodrugXlsxFile = async ( buffer: Buffer ): Promise<ParsedWhodrugFile> => {
    const rows: ParsedVaccineWhodrugRow[] = [];
    const rejected: RejectedVaccineWhodrugRow[] = [];
    // First appearance wins: the file is read top to bottom and a repeated id is a defect of the
    // file, not a correction of it.
    const seenExternalIds = new Set<number>();

    // Whole-book load instead of the streaming WorkbookReader. The reader of exceljs 4.4.0 resolves
    // the sheet name out of xl/workbook.xml, which is the last entry of the ZIP, so it throws on any
    // book whose entries do not arrive in the order it assumes — every book with more than one sheet
    // among them. memoryStorage already holds the whole buffer anyway, and the real file is ~500 KB.
    const workbook = new ExcelJS.Workbook();

    try {
        // exceljs types load() against Buffer<ArrayBuffer> while Node types the multer buffer as
        // Buffer<ArrayBufferLike>. They are the same object at runtime.
        await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch ( error ) {
        throw new WhodrugFileError('The uploaded file could not be read as a .xlsx workbook', error);
    }

    // Always the first sheet: the endpoint takes no `sheet` parameter, and its name travels in the
    // report so a book whose first tab was not the expected one says so.
    const worksheet = workbook.worksheets[0];

    if( !worksheet ) {
        throw new WhodrugFileError('The uploaded workbook carries no sheet');
    }

    const sheet = worksheet.name ?? '';
    const {
        columns,
        unknownHeaders,
        missingOptionalHeaders,
        missingRequiredHeaders
    } = readHeader(worksheet.getRow(1));

    // Not a single data row is read if a required header is missing, so the abort happens before
    // anything could be written.
    if( missingRequiredHeaders.length > 0 || columns.size === 0 ) {
        return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
    }

    worksheet.eachRow({ includeEmpty: false }, ( row ) => {
        if( row.number === 1 ) {
            return;
        }

        readDataRow(row, columns, rows, rejected, seenExternalIds);
    });

    return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
};

/**
 * Reads row 1 into a map of sheet column index -> vaccineWhodrug column, and sorts the headers the
 * file brought against the ones it should have brought.
 */
const readHeader = ( row: ExcelJS.Row ) => {
    const columns = new Map<number, string>();
    const unknownHeaders: string[] = [];
    const seenHeaders = new Set<string>();

    row.eachCell({ includeEmpty: false }, ( cell, columnNumber ) => {
        const text = cellToText(cell.value);

        if( text === null ) {
            return;
        }

        const column = NORMALIZED_ALIASES[normalizeHeader(text)];

        // An export that adds a column must not block the load of the whole dictionary. It is
        // ignored — and reported, because a column ignored in silence is a decision nobody reviews.
        if( !column ) {
            unknownHeaders.push(text);
            return;
        }

        // A header repeated in the sheet: the first column wins, same criterion as a repeated id.
        if( columns.has(columnNumber) || seenHeaders.has(column) ) {
            unknownHeaders.push(text);
            return;
        }

        seenHeaders.add(column);
        columns.set(columnNumber, column);
    });

    const missingRequiredHeaders = REQUIRED_HEADERS
        .filter(( header ) => !seenHeaders.has(HEADER_ALIASES[header]));

    const missingOptionalHeaders = Object.keys(HEADER_ALIASES)
        .filter(( header ) => !REQUIRED_HEADERS.includes(header) && !seenHeaders.has(HEADER_ALIASES[header]));

    return { columns, unknownHeaders, missingOptionalHeaders, missingRequiredHeaders };
};

/**
 * Reads one data row and either accepts it or rejects it with its reason. A rejection is counted and
 * the file keeps going: one bad cell must not cost the other 2999 rows.
 */
const readDataRow = (
    row: ExcelJS.Row,
    columns: Map<number, string>,
    rows: ParsedVaccineWhodrugRow[],
    rejected: RejectedVaccineWhodrugRow[],
    seenExternalIds: Set<number>
): void => {
    const rowNumber = row.number;
    const raw = new Map<string, ExcelJS.CellValue>();

    columns.forEach(( column, columnNumber ) => {
        raw.set(column, row.getCell(columnNumber).value);
    });

    // A row with nothing in any mapped column is not read and not invalid: it is nothing.
    const isEmpty = Array.from(raw.values()).every(( value ) => cellToText(value) === null);

    if( isEmpty ) {
        return;
    }

    const reject = ( reason: RejectedVaccineWhodrugRow['reason'], column?: string ): void => {
        rejected.push(column ? { row: rowNumber, reason, column } : { row: rowNumber, reason });
    };

    const rawExternalId = cellToText(raw.get('externalId') ?? null);
    const externalId = rawExternalId === null ? NaN : Number(rawExternalId);

    if( !Number.isInteger(externalId) ) {
        return reject('INVALID_EXTERNAL_ID');
    }

    // A dictionary entry is quoted data: trim only, never toConstantCase or toTitleCase.
    const drugCode = cellToText(raw.get('drugCode') ?? null);
    const drugName = cellToText(raw.get('drugName') ?? null);

    if( drugCode === null ) {
        return reject('EMPTY_DRUG_CODE');
    }

    // Empty would break the NOT NULL of the column on top of leaving the entry unreadable.
    if( drugName === null ) {
        return reject('EMPTY_DRUG_NAME');
    }

    // Every column of the file starts at null so that a missing optional header leaves its column as
    // null in every row, and the update diff compares against a value instead of against an absence.
    const values: Record<string, string | boolean | null> = {};

    for( const column of Object.values(HEADER_ALIASES) ) {
        if( column === 'externalId' || column === 'drugCode' || column === 'drugName' ) {
            continue;
        }

        // isPreferred is NOT NULL DEFAULT false and admits no null in any layer; isGeneric got no
        // DEFAULT in the DDL, so null is a value of its own, distinct from false.
        values[column] = column === 'isPreferred' ? false : null;
    }

    // drugCode is the only key column with a varchar limit; drugName is text and has none.
    if( drugCode.length > MAX_LENGTHS.drugCode ) {
        return reject('VALUE_TOO_LONG', 'drugCode');
    }

    for( const column of columns.values() ) {
        if( column === 'externalId' || column === 'drugCode' || column === 'drugName' ) {
            continue;
        }

        if( BOOLEAN_COLUMNS.includes(column) ) {
            const parsed = cellToBoolean(raw.get(column) ?? null);

            values[column] = column === 'isPreferred' ? parsed ?? false : parsed;
            continue;
        }

        const text = cellToText(raw.get(column) ?? null);
        const maxLength = MAX_LENGTHS[column];

        // Without this filter the row would blow up the whole batch it travels in.
        if( text !== null && maxLength !== undefined && text.length > maxLength ) {
            return reject('VALUE_TOO_LONG', column);
        }

        values[column] = text;
    }

    if( seenExternalIds.has(externalId) ) {
        return reject('DUPLICATE_IN_FILE');
    }

    seenExternalIds.add(externalId);
    rows.push({
        row: rowNumber,
        externalId,
        drugCode,
        drugName,
        values: values as unknown as VaccineWhodrugFileValues
    });
};
