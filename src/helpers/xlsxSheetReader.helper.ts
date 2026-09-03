import ExcelJS from 'exceljs';

/**
 * Raised only when the book cannot be read as the caller asked: it carries no sheet at all, or the
 * requested sheet is not in it. The domain parsers rewrap it in their own error class — the services
 * check those with instanceof to answer 400 — so a real defect never disguises itself as a bad file.
 */
export class XlsxFileError extends Error {
    constructor( message: string, public readonly cause?: unknown ) {
        super(message);
        this.name = 'XlsxFileError';
    }
}

/**
 * One data row of the sheet. `row` is 1-based over the sheet, so row 1 is the header and data starts
 * at 2 — the number an operator reads in Excel and the one that travels in the report.
 * `cells` carries one key per column the sheet actually brought, trimmed, with null on an empty
 * cell — never ''. A column the sheet does not bring has no key at all, which is what lets a caller
 * tell "the column is absent" from "the cell is empty"; the reader itself draws no conclusion from
 * either.
 */
export interface RawSheetRow {
    row: number;
    cells: Record<string, string | null>;
}

export interface ReadSheetResult {
    sheet: string;
    rows: RawSheetRow[];
    // Non-empty means the caller aborts before writing anything, and rows comes back empty
    missingRequiredHeaders: string[];
    // Optional headers the sheet does not bring. What that means for a column is the caller's call
    missingOptionalHeaders: string[];
    // Headers with no destination: ignored, but never in silence
    unknownHeaders: string[];
}

export interface ReadSheetOptions {
    // Normalized sheet name or 0-based index. Defaults to the first sheet
    sheet?: string | number;
    // Header as the file writes it -> destination column. The keys are what the missing lists report
    headerAliases: Record<string, string>;
    // Keys of headerAliases, not destination columns. What is required is that the column exists,
    // never that it carries a value
    requiredHeaders: string[];
}

/**
 * Lowercase and drop the separators a header mixes in the same row, so that 'catalog type code',
 * 'catalog_type_code' and 'CatalogTypeCode' all resolve to the same column. Applied to both sides of
 * the comparison, and to sheet names too when a sheet is selected by name.
 */
export const normalizeHeader = ( header: string ): string =>
    header.trim().toLowerCase().replace(/[\s\-_]/g, '');

/**
 * A cell as text. exceljs hands back strings, numbers, booleans, dates, rich text and formula
 * results depending on how the cell was written, and a transcribed file is text in all of them.
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
 * The sheet the caller asked for. By index when a number travels — 0 by default, which is what the
 * two importers that take no `sheet` parameter have always read — and by normalized name when a
 * string does, so a tab written 'Geo Location' matches 'geoLocation'.
 */
const selectWorksheet = ( workbook: ExcelJS.Workbook, sheet: string | number ): ExcelJS.Worksheet => {
    if( typeof sheet === 'number' ) {
        const worksheet = workbook.worksheets[sheet];

        if( !worksheet ) {
            throw new XlsxFileError('The uploaded workbook carries no sheet');
        }

        return worksheet;
    }

    const wanted = normalizeHeader(sheet);
    const worksheet = workbook.worksheets
        .find(( candidate ) => normalizeHeader(candidate.name ?? '') === wanted);

    if( !worksheet ) {
        throw new XlsxFileError(`The uploaded workbook has no sheet named '${ sheet }'`);
    }

    return worksheet;
};

/**
 * Reads row 1 into a map of sheet column index -> destination column, and sorts the headers the
 * sheet brought against the ones it should have brought.
 */
const readHeader = (
    row: ExcelJS.Row,
    headerAliases: Record<string, string>,
    requiredHeaders: string[],
    normalizedAliases: Record<string, string>
) => {
    const columns = new Map<number, string>();
    const unknownHeaders: string[] = [];
    const seenHeaders = new Set<string>();

    row.eachCell({ includeEmpty: false }, ( cell, columnNumber ) => {
        const text = cellToText(cell.value);

        if( text === null ) {
            return;
        }

        const column = normalizedAliases[normalizeHeader(text)];

        // A sheet that carries an extra column must not block the load. It is ignored — and
        // reported, because a column ignored in silence is a decision nobody reviews.
        if( !column ) {
            unknownHeaders.push(text);
            return;
        }

        // A header repeated in the sheet: the first column wins, same criterion every importer
        // applies to a repeated key.
        if( columns.has(columnNumber) || seenHeaders.has(column) ) {
            unknownHeaders.push(text);
            return;
        }

        seenHeaders.add(column);
        columns.set(columnNumber, column);
    });

    const missingRequiredHeaders = requiredHeaders
        .filter(( header ) => !seenHeaders.has(headerAliases[header]));

    const missingOptionalHeaders = Object.keys(headerAliases)
        .filter(( header ) => !requiredHeaders.includes(header) && !seenHeaders.has(headerAliases[header]));

    return { columns, unknownHeaders, missingOptionalHeaders, missingRequiredHeaders };
};

/**
 * Reads one sheet of an already loaded workbook — header on row 1, data from row 2 — and hands back
 * its rows as trimmed text.
 *
 * Pure function, and deliberately ignorant: it does not normalize a name, mint a code, coerce a
 * number, deduplicate a key or validate anything. Every rule of that kind belongs to the parser of
 * each domain, which is what keeps three importers with three different sets of rules on one reader.
 *
 * A missing required header stops the read before a single data row is touched, so a caller that
 * aborts on it aborts before anything could be written.
 */
export const readSheet = ( workbook: ExcelJS.Workbook, options: ReadSheetOptions ): ReadSheetResult => {
    const { sheet = 0, headerAliases, requiredHeaders } = options;
    const rows: RawSheetRow[] = [];

    // The alias table keyed by its normalized header, built per call: the tables are a handful of
    // entries and building it here keeps the reader free of module-level state.
    const normalizedAliases: Record<string, string> = Object.entries(headerAliases)
        .reduce(( map, [ header, column ] ) => ({ ...map, [normalizeHeader(header)]: column }), {});

    const worksheet = selectWorksheet(workbook, sheet);
    const sheetName = worksheet.name ?? '';
    const {
        columns,
        unknownHeaders,
        missingOptionalHeaders,
        missingRequiredHeaders
    } = readHeader(worksheet.getRow(1), headerAliases, requiredHeaders, normalizedAliases);

    if( missingRequiredHeaders.length > 0 || columns.size === 0 ) {
        return { sheet: sheetName, rows, missingRequiredHeaders, missingOptionalHeaders, unknownHeaders };
    }

    worksheet.eachRow({ includeEmpty: false }, ( row ) => {
        if( row.number === 1 ) {
            return;
        }

        // Column order, so a caller that reports the first offending column reports the one the
        // operator reads leftmost.
        const cells: Record<string, string | null> = {};

        columns.forEach(( column, columnNumber ) => {
            cells[column] = cellToText(row.getCell(columnNumber).value);
        });

        // A row with nothing in any mapped column is not read and not invalid: it is nothing.
        const isEmpty = Object.values(cells).every(( value ) => value === null);

        if( isEmpty ) {
            return;
        }

        rows.push({ row: row.number, cells });
    });

    return { sheet: sheetName, rows, missingRequiredHeaders, missingOptionalHeaders, unknownHeaders };
};
