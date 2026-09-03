import ExcelJS from 'exceljs';

import { toCamelCase, toCodeFromName, toTitleCase } from './stringHandling.helper';
import { RawSheetRow, XlsxFileError, readSheet } from './xlsxSheetReader.helper';
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

/**
 * A cell as sortOrder. Empty, non-numeric, non-integer, negative or above the smallint ceiling all
 * enter as 0 and flag the coercion; it never rejects the row. The order of a dropdown is not worth
 * a lost item, and the counter is what keeps the coercion from being silent.
 */
const cellToSortOrder = ( text: string | null ): { sortOrder: number; coerced: boolean } => {
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
    // report so a book whose first tab was not the expected one says so. A book with no sheet at all
    // comes back from the reader as an XlsxFileError, rewrapped below.
    //
    // The reader resolves the header, discards the empty rows and hands every cell back as trimmed
    // text; an extra column, a repeated header and a missing optional one are all sorted there. What
    // stays here is what is catalogItem: the normalization, the minted code and the file's own pairs.
    let read;

    try {
        read = readSheet(workbook, { headerAliases: HEADER_ALIASES, requiredHeaders: REQUIRED_HEADERS });
    } catch ( error ) {
        // The reader raises its own class; the service checks this one with instanceof to answer 400
        throw new CatalogItemFileError(
            error instanceof XlsxFileError ? error.message : 'The uploaded workbook could not be read',
            error
        );
    }

    const { sheet, rows: rawRows, unknownHeaders, missingOptionalHeaders, missingRequiredHeaders } = read;

    // Not a single data row is read if a required header is missing, so the abort happens before
    // anything could be written — in either of the two tables.
    if( missingRequiredHeaders.length > 0 ) {
        return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
    }

    for( const rawRow of rawRows ) {
        readDataRow(rawRow, rows, rejected, seenPairs);
    }

    return { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders };
};

/**
 * Reads one data row and either accepts it or rejects it with its reason. A rejection is counted and
 * the file keeps going: one bad cell must not cost the rest of the catalog.
 */
const readDataRow = (
    { row: rowNumber, cells }: RawSheetRow,
    rows: ParsedCatalogItemRow[],
    rejected: RejectedCatalogItemRow[],
    seenPairs: Set<string>
): void => {
    const reject = ( reason: RejectedCatalogItemRow['reason'], column?: string ): void => {
        rejected.push(column ? { row: rowNumber, reason, column } : { row: rowNumber, reason });
    };

    // A catalogItem is configuration coined in this application and not quoted dictionary data, so
    // unlike the two importers before it this one normalizes on write, and with the same rule the
    // 001 and the 004 use: the code is minted from the name with toCodeFromName and the sheet has no
    // say in it.
    const rawCatalogTypeCode = cells.catalogTypeCode ?? null;
    const rawCatalogTypeName = cells.catalogTypeName ?? null;
    const rawName = cells.name ?? null;

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
    const value = cells.value ?? name;
    const description = cells.description ?? null;

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

    const { sortOrder, coerced } = cellToSortOrder(cells.sortOrder ?? null);

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
