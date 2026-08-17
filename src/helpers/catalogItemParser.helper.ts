import ExcelJS from 'exceljs';

import { toCamelCase, toCodeFromName, toTitleCase } from './stringHandling.helper';
import {
    CatalogItemFileValues,
    ParsedCatalogItemRow,
    RejectedCatalogItemRow
} from '../types/catalog/catalogItem.types';

// The six columns of the file, mapped to their destination. Unlike the WHODrug export, which
// writes 'drugRecNo+Seq01' and 'forms_medicinalProductID', this header is authored here and every
// name already matches its column — the table exists so the whole header reads in one place and so
// an alias can be added later without touching the reader.
// There is no 'code': the code of an item is minted from its name and never read from the sheet, so
// a file that still carries the column has it reported in unknownHeaders and ignored
const HEADER_ALIASES: Record<string, string> = {
    'catalogTypeCode': 'catalogTypeCode',
    'catalogTypeName': 'catalogTypeName',
    'name': 'name',
    'value': 'value',
    'description': 'description',
    'sortOrder': 'sortOrder'
};

// Without these three a row cannot be placed: the first two are what resolves — or founds — the
// type, and name is both the NOT NULL column of catalogItem and the source of its code. What is
// required is that the column exists, not that it carries a value: an empty catalogTypeName only
// rejects its row, and only if the type turns out not to exist, which the service decides and this
// parser cannot
const REQUIRED_HEADERS = [ 'catalogTypeCode', 'catalogTypeName', 'name' ];

// varchar limits of the two DDLs, and they are not the same table: catalogItem.name is 250 while
// catalogType.name is 200. code is still checked although the sheet no longer brings it: it is
// minted from a name of up to 250 characters and its own column only admits 100, so a long name
// rejects its row naming `code` and not `name`. description is absent because it is text and has no
// limit to check.
// Filtering here is what keeps one oversized cell from blowing up the whole batch
const MAX_LENGTHS: Record<string, number> = {
    catalogTypeCode: 100,
    catalogTypeName: 200,
    code: 100,
    name: 250,
    value: 250
};

// smallint, and the column carries CHECK ("sortOrder" >= 0)
const MAX_SORT_ORDER = 32767;

/**
 * Raised only when the book itself cannot be read: the buffer is not a valid .xlsx or it carries no
 * sheet. The service turns it into a 400, and anything else thrown by the parser stays a 500, so a
 * real defect never disguises itself as a bad file.
 */
export class CatalogItemFileError extends Error {
    constructor( message: string, public readonly cause?: unknown ) {
        super(message);
        this.name = 'CatalogItemFileError';
    }
}

export interface ParsedCatalogItemFile {
    sheet: string;
    rows: ParsedCatalogItemRow[];
    rejected: RejectedCatalogItemRow[];
    // Optional headers the file does not bring: their column enters as null — or 0 for sortOrder —
    // in every row
    missingOptionalHeaders: string[];
    // Headers with no destination: ignored, but never in silence
    unknownHeaders: string[];
    // Non-empty means the caller aborts with 400 before writing anything. rows comes back empty
    missingRequiredHeaders: string[];
}

// Lowercase and drop the separators a hand-authored sheet mixes in the same row, so that
// 'catalog type code', 'catalog_type_code' and 'CatalogTypeCode' all resolve to the same column.
// Applied to both sides of the comparison
const normalizeHeader = ( header: string ): string =>
    header.trim().toLowerCase().replace(/[\s\-_]/g, '');

// The alias table, keyed by its normalized header, built once at load time
const NORMALIZED_ALIASES: Record<string, string> = Object.entries(HEADER_ALIASES)
    .reduce(( map, [ header, column ] ) => ({ ...map, [normalizeHeader(header)]: column }), {});

/**
 * A cell as text. exceljs hands back strings, numbers, booleans, dates, rich text and formula
 * results depending on how the cell was written, and the catalog is text in all of them.
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
 * A cell as sortOrder. Empty, non-numeric, non-integer, negative or above the smallint ceiling all
 * enter as 0 and flag the coercion; it never rejects the row. The order of a dropdown is not worth
 * a lost item, and the counter is what keeps the coercion from being silent.
 */
const cellToSortOrder = ( value: ExcelJS.CellValue ): { sortOrder: number; coerced: boolean } => {
    const text = cellToText(value);

    if( text === null ) {
        return { sortOrder: 0, coerced: true };
    }

    const parsed = Number(text);

    if( !Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SORT_ORDER ) {
        return { sortOrder: 0, coerced: true };
    }

    // An explicit 0 is a legitimate position and not a coercion: the counter must not report it
    return { sortOrder: parsed, coerced: false };
};

/**
 * Parses a catalogItem .xlsx — first sheet, header on row 1, data from row 2.
 * Pure function: it does not touch the database and decides nothing about what is inserted, updated
 * or which types have to be founded, which is the service's business.
 *
 * Normalization happens here and not in the service because uniqueness is compared against the
 * normalized value and this is where the file's own duplicates are detected: toTitleCase for both
 * names, toCamelCase for catalogType.code and toCodeFromName for catalogItem.code, which is minted
 * from the name — exactly what the two services already do, each to its table. Since the code is
 * derived, the name is what identifies an item inside its type: two rows with the same name under
 * the same type are the same row, and a name changed in the file is a new item and not a rename.
 *
 * A rejected row never aborts the parse; it is counted and the file keeps going. Only two content
 * problems stop the read, and both stop it before any write: a book that cannot be opened and a
 * missing required header.
 */
export const parseCatalogItemsXlsxFile = async ( buffer: Buffer ): Promise<ParsedCatalogItemFile> => {
    const rows: ParsedCatalogItemRow[] = [];
    const rejected: RejectedCatalogItemRow[] = [];
    // First appearance wins: the file is read top to bottom and a repeated pair is a defect of the
    // file, not a correction of it. The key is the pair and not the code alone — 'ACTIVO' under two
    // different types are two legitimate items, which is what UQ_catalogItem_type_code says.
    const seenPairs = new Set<string>();

    // Whole-book load instead of the streaming WorkbookReader, for the same reason as the WHODrug
    // parser: the reader of exceljs 4.4.0 throws on any book whose ZIP entries do not arrive in the
    // order it assumes. memoryStorage already holds the whole buffer anyway.
    const workbook = new ExcelJS.Workbook();

    try {
        // exceljs types load() against Buffer<ArrayBuffer> while Node types the multer buffer as
        // Buffer<ArrayBufferLike>. They are the same object at runtime.
        await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch ( error ) {
        throw new CatalogItemFileError('The uploaded file could not be read as a .xlsx workbook', error);
    }

    // Always the first sheet: the endpoint takes no `sheet` parameter, and its name travels in the
    // report so a book whose first tab was not the expected one says so.
    const worksheet = workbook.worksheets[0];

    if( !worksheet ) {
        throw new CatalogItemFileError('The uploaded workbook carries no sheet');
    }

    const sheet = worksheet.name ?? '';
    const {
        columns,
        unknownHeaders,
        missingOptionalHeaders,
        missingRequiredHeaders
    } = readHeader(worksheet.getRow(1));

    // Not a single data row is read if a required header is missing, so the abort happens before
    // anything could be written — in either of the two tables.
    if( missingRequiredHeaders.length > 0 || columns.size === 0 ) {
        return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
    }

    worksheet.eachRow({ includeEmpty: false }, ( row ) => {
        if( row.number === 1 ) {
            return;
        }

        readDataRow(row, columns, rows, rejected, seenPairs);
    });

    return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
};

/**
 * Reads row 1 into a map of sheet column index -> destination column, and sorts the headers the file
 * brought against the ones it should have brought.
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

        // A sheet that carries an extra column must not block the load. It is ignored — and
        // reported, because a column ignored in silence is a decision nobody reviews.
        if( !column ) {
            unknownHeaders.push(text);
            return;
        }

        // A header repeated in the sheet: the first column wins, same criterion as a repeated pair.
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
 * the file keeps going: one bad cell must not cost the rest of the catalog.
 */
const readDataRow = (
    row: ExcelJS.Row,
    columns: Map<number, string>,
    rows: ParsedCatalogItemRow[],
    rejected: RejectedCatalogItemRow[],
    seenPairs: Set<string>
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

    const reject = ( reason: RejectedCatalogItemRow['reason'], column?: string ): void => {
        rejected.push(column ? { row: rowNumber, reason, column } : { row: rowNumber, reason });
    };

    // A catalogItem is configuration coined in this application and not quoted dictionary data, so
    // unlike the two importers before it this one normalizes on write, and with the same rule the
    // 001 and the 004 use: the code is minted from the name with toCodeFromName and the sheet has no
    // say in it.
    const rawCatalogTypeCode = cellToText(raw.get('catalogTypeCode') ?? null);
    const rawCatalogTypeName = cellToText(raw.get('catalogTypeName') ?? null);
    const rawName = cellToText(raw.get('name') ?? null);

    if( rawCatalogTypeCode === null ) {
        return reject('EMPTY_CATALOG_TYPE_CODE');
    }

    // Empty would break the NOT NULL of the column on top of leaving the item without a code.
    if( rawName === null ) {
        return reject('EMPTY_NAME');
    }

    const catalogTypeCode = toCamelCase(rawCatalogTypeCode);
    // Not a rejection when empty: the parser cannot know whether the type already exists. It travels
    // as null and phase 3 of the service rejects the row only if the type has to be created.
    const catalogTypeName = rawCatalogTypeName === null ? null : toTitleCase(rawCatalogTypeName);
    const name = toTitleCase(rawName);
    // Minted from the already normalized name, which is what makes it stable: the code stored for a
    // name is the one that same stored name mints again, so a reimport of an untouched file sees no
    // change. A name of only separators — '---' — passes the NOT NULL of its column and still mints
    // nothing, and an item with an empty code would occupy the pair of the next one like it
    const code = toCodeFromName(name);

    if( code.length === 0 ) {
        return reject('EMPTY_CODE');
    }
    // The one column that never enters null. The model declares value allowNull: false while the DDL
    // admits null, and an empty cell would insert fine — bulkCreate does not validate — but would 500
    // on the update branch that empties it. An empty cell carries the already normalized name, so the
    // two columns of that row come out identical and the diff keeps its four candidates
    const value = cellToText(raw.get('value') ?? null) ?? name;
    const description = cellToText(raw.get('description') ?? null);

    // Length is checked against the normalized value because that is the one that reaches the
    // column. Without this filter the row would blow up the whole batch it travels in.
    // code goes last on purpose: it is minted from name, so an oversized name overflows both and the
    // operator has to be pointed at the cell they wrote. Naming code is then left for the case that
    // is really its own — a name within its 250 whose code does not fit in its 100
    const lengths: Record<string, string | null> = { catalogTypeCode, catalogTypeName, name, value, code };

    for( const [ column, text ] of Object.entries(lengths) ) {
        if( text !== null && text.length > MAX_LENGTHS[column] ) {
            return reject('VALUE_TOO_LONG', column);
        }
    }

    const { sortOrder, coerced } = cellToSortOrder(raw.get('sortOrder') ?? null);

    const pair = `${ catalogTypeCode }|${ code }`;

    if( seenPairs.has(pair) ) {
        return reject('DUPLICATE_IN_FILE');
    }

    seenPairs.add(pair);

    const values: CatalogItemFileValues = { value, description, sortOrder };

    rows.push({
        row: rowNumber,
        catalogTypeCode,
        catalogTypeName,
        code,
        name,
        values,
        sortOrderCoerced: coerced
    });
};
