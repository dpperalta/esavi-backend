import ExcelJS from 'exceljs';

import { toConstantCase, toTitleCase } from './stringHandling.helper';
import { RawSheetRow, XlsxFileError, normalizeHeader, readSheet } from './xlsxSheetReader.helper';
import {
    GeoRejectionReason,
    ParsedGeoLocationRow,
    ParsedHealthFacilityRow,
    RejectedGeoRow
} from '../types/geography/geoImport.types';

// The three sheets, matched by normalized name and never by position: a book whose tabs were
// reordered is the same book. 'catalogs' is named here only so it can be ignored — it is generated
// to feed the Excel dropdowns and the importer never reads a single cell of it, so it does not even
// reach unknownHeaders
export const GEO_LOCATION_SHEET = 'geoLocation';
export const HEALTH_FACILITY_SHEET = 'healthFacility';
export const CATALOGS_SHEET = 'catalogs';

// Sheet 1. The header is authored here — by the 007 — so every name already matches its column; the
// table exists so the whole header reads in one place and so an alias can be added later.
// There is no geoLevelTypeId and no geoPolygon: the first is resolved from level and the second is
// not transcribable in a cell
const GEO_LOCATION_ALIASES: Record<string, string> = {
    'externalCode': 'externalCode',
    'name': 'name',
    'level': 'level',
    'parentCode': 'parentCode',
    'officialName': 'officialName',
    'shortName': 'shortName',
    'isoCode': 'isoCode',
    'latitude': 'latitude',
    'longitude': 'longitude',
    'sortOrder': 'sortOrder'
};

// parentCode is required as a HEADER even though its CELL is legitimately empty at level 1: what
// cannot be missing is the column. Without it every row above level 1 would look like a root
const GEO_LOCATION_REQUIRED = [ 'externalCode', 'name', 'level', 'parentCode' ];

// Sheet 2. parentLocalCode is optional here and not required as in sheet 1, because the facility
// hierarchy has no level column: a facility with no parent is the ordinary case and the column can
// be left out of the book entirely
const HEALTH_FACILITY_ALIASES: Record<string, string> = {
    'localCode': 'localCode',
    'name': 'name',
    'geoExternalCode': 'geoExternalCode',
    'facilityTypeCode': 'facilityTypeCode',
    'officialName': 'officialName',
    'shortName': 'shortName',
    'address': 'address',
    'latitude': 'latitude',
    'longitude': 'longitude',
    'phone': 'phone',
    'email': 'email',
    'parentLocalCode': 'parentLocalCode'
};

const HEALTH_FACILITY_REQUIRED = [ 'localCode', 'name', 'geoExternalCode', 'facilityTypeCode' ];

// varchar limits of the geoLocation DDL. The numeric columns are absent because they have no length
// to check, and level is absent because it is validated as an integer, not as text.
// Filtering here is what keeps one oversized cell from blowing up the whole batch it travels in
const GEO_LOCATION_MAX_LENGTHS: Record<string, number> = {
    externalCode: 100,
    name: 200,
    officialName: 250,
    shortName: 100,
    isoCode: 20
};

// varchar limits of the healthFacility DDL. email is citext with no declared limit, and parentCode
// is checked against localCode's own limit because it points at one
const HEALTH_FACILITY_MAX_LENGTHS: Record<string, number> = {
    localCode: 200,
    parentLocalCode: 200,
    name: 250,
    officialName: 250,
    shortName: 100,
    address: 250,
    phone: 50
};

// smallint, and the column carries CHECK ("sortOrder" >= 0)
const MAX_SORT_ORDER = 32767;

// The ceiling of the walk that detects cycles inside the file, the same one SPEC 09 uses to walk the
// facility tree. A file deeper than this is a defect of the file, not an administrative division
const MAX_HIERARCHY_DEPTH = 50;

/**
 * Raised when the content of the book stops the operation before anything could be written: an
 * unreadable buffer, a missing geoLocation sheet, an incomplete required header or a book with no
 * valid row at all. The service turns it into a 400, and anything else thrown by the parser stays a
 * 500, so a real defect never disguises itself as a bad file.
 */
export class GeoImportFileError extends Error {
    constructor( message: string, public readonly cause?: unknown ) {
        super(message);
        this.name = 'GeoImportFileError';
    }
}

export interface ParsedGeoImportFile {
    sheets: { geoLocation: string; healthFacility: string | null };
    geoLocations: ParsedGeoLocationRow[];
    healthFacilities: ParsedHealthFacilityRow[];
    rejected: RejectedGeoRow[];
    // read counts every row the sheet brought, valid or not: it is what makes the report's counters
    // close, and it is not derivable from the arrays above
    read: { geoLocation: number; healthFacility: number };
    // Optional headers the sheet does not bring. Their column enters the diff as undefined, so an
    // existing row keeps its stored value — which is not the same as an empty cell proposing null
    missingOptionalHeaders: { geoLocation: string[]; healthFacility: string[] };
    // Headers with no destination: ignored, but never in silence
    unknownHeaders: { geoLocation: string[]; healthFacility: string[] };
}

/**
 * A cell as an integer level. Empty is not the same as invalid: an operator who left the cell blank
 * and one who wrote 'provincia' in it made two different mistakes and read two different reasons.
 */
const readLevel = ( text: string | null ): { level: number; reason: GeoRejectionReason | null } => {
    if( text === null ) {
        return { level: 0, reason: 'EMPTY_LEVEL' };
    }

    const parsed = Number(text);

    // Level 0 does not exist: the series of geoLevelType.sortOrder starts at 1, and a 0 here would
    // resolve to no level type at all
    if( !Number.isInteger(parsed) || parsed < 1 ) {
        return { level: 0, reason: 'INVALID_LEVEL' };
    }

    return { level: parsed, reason: null };
};

/**
 * A cell as sortOrder. Empty, non-numeric, non-integer, negative or above the smallint ceiling all
 * enter as 0 and flag the coercion; it never rejects the row, exactly as in F20.
 *
 * This is also the declared divergence from the 001, which would compute max(sortOrder) + 1 among
 * siblings: inside a bulkCreate that computation would hand the same value to every new row of the
 * batch, and reimporting the same file would produce a different value each time.
 */
const readSortOrder = ( text: string | null ): { sortOrder: number; coerced: boolean } => {
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
 * A cell as a coordinate. numeric(10,7) admits no reason of its own in the rejection union — there
 * is no INVALID_LATITUDE — so an unreadable coordinate enters as null and the row is kept: the
 * position of a point on a map is not worth losing a province over, and the cell can be corrected
 * with the next import.
 */
const readCoordinate = ( text: string | null ): number | null => {
    if( text === null ) {
        return null;
    }

    const parsed = Number(text);

    return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Reads sheet 1. Rejects by cell only — everything that depends on the database is the service's
 * business — and normalizes with .trim() alone: createGeoLocationService applies neither
 * toTitleCase to the name nor toConstantCase to the code, and an importer that normalized would
 * create rows the 001 could not find again.
 */
const readGeoLocationRows = (
    rawRows: RawSheetRow[],
    rows: ParsedGeoLocationRow[],
    rejected: RejectedGeoRow[]
): void => {
    // First appearance wins: the file is read top to bottom and a repeated code is a defect of the
    // file, not a correction of it
    const seenCodes = new Set<string>();

    for( const { row, cells } of rawRows ) {
        const reject = ( reason: GeoRejectionReason, column?: string ): void => {
            rejected.push(column
                ? { sheet: 'geoLocation', row, reason, column }
                : { sheet: 'geoLocation', row, reason });
        };

        const externalCode = cells.externalCode ?? null;
        const name = cells.name ?? null;
        const parentCode = cells.parentCode ?? null;

        if( externalCode === null ) {
            reject('EMPTY_EXTERNAL_CODE');
            continue;
        }

        // Empty would break the NOT NULL of the column on top of leaving the row unreadable
        if( name === null ) {
            reject('EMPTY_NAME');
            continue;
        }

        const { level, reason } = readLevel(cells.level ?? null);

        if( reason !== null ) {
            reject(reason);
            continue;
        }

        // A root with a parent and a child without one are the two halves of the same mistake, and
        // each reads its own reason so the operator knows which cell to look at
        if( level === 1 && parentCode !== null ) {
            reject('UNEXPECTED_PARENT_CODE');
            continue;
        }

        if( level > 1 && parentCode === null ) {
            reject('MISSING_PARENT_CODE');
            continue;
        }

        const lengths: Record<string, string | null> = {
            externalCode,
            name,
            officialName: cells.officialName ?? null,
            shortName: cells.shortName ?? null,
            isoCode: cells.isoCode ?? null
        };

        let tooLong: string | null = null;

        for( const [ column, text ] of Object.entries(lengths) ) {
            if( text !== null && text.length > GEO_LOCATION_MAX_LENGTHS[column] ) {
                tooLong = column;
                break;
            }
        }

        if( tooLong !== null ) {
            reject('VALUE_TOO_LONG', tooLong);
            continue;
        }

        if( seenCodes.has(externalCode) ) {
            reject('DUPLICATE_IN_FILE');
            continue;
        }

        const { sortOrder, coerced } = readSortOrder(cells.sortOrder ?? null);

        seenCodes.add(externalCode);
        rows.push({
            row,
            externalCode,
            parentCode,
            name,
            level,
            values: {
                officialName: cells.officialName ?? null,
                shortName: cells.shortName ?? null,
                isoCode: cells.isoCode ?? null,
                latitude: readCoordinate(cells.latitude ?? null),
                longitude: readCoordinate(cells.longitude ?? null),
                sortOrder
            },
            sortOrderCoerced: coerced
        });
    }
};

/**
 * Reads sheet 2. Unlike sheet 1 this one does normalize — toConstantCase on the code and toTitleCase
 * on the name — because that is what healthFacility's own 001 has done since SPEC 09, and
 * uniqueness has to be compared against the value that actually reaches the column.
 */
const readHealthFacilityRows = (
    rawRows: RawSheetRow[],
    rows: ParsedHealthFacilityRow[],
    rejected: RejectedGeoRow[]
): void => {
    const seenCodes = new Set<string>();

    for( const { row, cells } of rawRows ) {
        const reject = ( reason: GeoRejectionReason, column?: string ): void => {
            rejected.push(column
                ? { sheet: 'healthFacility', row, reason, column }
                : { sheet: 'healthFacility', row, reason });
        };

        const rawLocalCode = cells.localCode ?? null;
        const rawName = cells.name ?? null;
        const geoExternalCode = cells.geoExternalCode ?? null;
        const facilityTypeCode = cells.facilityTypeCode ?? null;
        const rawParentLocalCode = cells.parentLocalCode ?? null;

        if( rawLocalCode === null ) {
            reject('EMPTY_LOCAL_CODE');
            continue;
        }

        if( rawName === null ) {
            reject('EMPTY_NAME');
            continue;
        }

        // The facility hangs from a geolocation and carries a type: without either of them the row
        // cannot be placed, and neither is resolvable here — the service does that against the base
        if( geoExternalCode === null ) {
            reject('EMPTY_GEO_CODE');
            continue;
        }

        if( facilityTypeCode === null ) {
            reject('EMPTY_FACILITY_TYPE');
            continue;
        }

        const localCode = toConstantCase(rawLocalCode);
        const name = toTitleCase(rawName);
        // Normalized with the same rule as localCode, because it points at one: a parent written
        // 'hosp central' has to resolve against the row that stored 'HOSP_CENTRAL'
        const parentLocalCode = rawParentLocalCode === null ? null : toConstantCase(rawParentLocalCode);

        // Length is checked against the normalized value, which is the one that reaches the column
        const lengths: Record<string, string | null> = {
            localCode,
            parentLocalCode,
            name,
            officialName: cells.officialName ?? null,
            shortName: cells.shortName ?? null,
            address: cells.address ?? null,
            phone: cells.phone ?? null
        };

        let tooLong: string | null = null;

        for( const [ column, text ] of Object.entries(lengths) ) {
            if( text !== null && text.length > HEALTH_FACILITY_MAX_LENGTHS[column] ) {
                tooLong = column;
                break;
            }
        }

        if( tooLong !== null ) {
            reject('VALUE_TOO_LONG', tooLong);
            continue;
        }

        if( seenCodes.has(localCode) ) {
            reject('DUPLICATE_IN_FILE');
            continue;
        }

        seenCodes.add(localCode);
        rows.push({
            row,
            localCode,
            name,
            geoExternalCode,
            facilityTypeCode,
            parentLocalCode,
            values: {
                officialName: cells.officialName ?? null,
                shortName: cells.shortName ?? null,
                address: cells.address ?? null,
                latitude: readCoordinate(cells.latitude ?? null),
                longitude: readCoordinate(cells.longitude ?? null),
                phone: cells.phone ?? null,
                email: cells.email ?? null
            }
        });
    }
};

/**
 * Rejects with CYCLE every row of sheet 1 that sits on a cycle of the file itself.
 *
 * Only the file is walked: a parentCode that is not in the book is not a cycle, it is a parent the
 * service will look for in the database. The visited set and the hop ceiling are the same guards
 * SPEC 09 uses to walk the facility tree — a walk with no ceiling over a corrupted file does not
 * come back.
 */
const rejectCycles = ( rows: ParsedGeoLocationRow[], rejected: RejectedGeoRow[] ): ParsedGeoLocationRow[] => {
    const byCode = new Map<string, ParsedGeoLocationRow>();

    for( const row of rows ) {
        byCode.set(row.externalCode, row);
    }

    const onCycle = new Set<string>();

    for( const row of rows ) {
        const path: string[] = [];
        const visited = new Set<string>();
        let current: ParsedGeoLocationRow | undefined = row;
        let hops = 0;

        while( current && hops < MAX_HIERARCHY_DEPTH ) {
            if( visited.has(current.externalCode) ) {
                // Everything from the first repetition onwards is the cycle itself; what precedes it
                // is a row that merely hangs from one, and that is a cascade the service reports as
                // ORPHAN, not a cycle of its own
                const closes = path.indexOf(current.externalCode);

                path.slice(closes).forEach(( code ) => onCycle.add(code));
                break;
            }

            visited.add(current.externalCode);
            path.push(current.externalCode);

            const parentCode: string | null = current.parentCode;

            current = parentCode === null ? undefined : byCode.get(parentCode);
            hops++;
        }

        // A chain deeper than the ceiling is treated as a cycle: it cannot be walked to a root and
        // writing it would be writing something nobody can read back
        if( hops >= MAX_HIERARCHY_DEPTH ) {
            path.forEach(( code ) => onCycle.add(code));
        }
    }

    if( onCycle.size === 0 ) {
        return rows;
    }

    const kept: ParsedGeoLocationRow[] = [];

    for( const row of rows ) {
        if( onCycle.has(row.externalCode) ) {
            rejected.push({ sheet: 'geoLocation', row: row.row, reason: 'CYCLE' });
            continue;
        }

        kept.push(row);
    }

    return kept;
};

/**
 * Parses the three-sheet .xlsx of ESAVI-GEOLOC-006 — header on row 1, data from row 2 on each sheet.
 *
 * Pure function: it does not touch the database and decides nothing about what is inserted or
 * updated. Eleven of the rejection reasons are therefore not emitted here but by the service, which
 * is the only one that can resolve a parent, a level type or a facility type.
 *
 * A rejected row never aborts the parse; it is counted and the file keeps going. Only four content
 * problems stop the read, and all four stop it before any write: a book that cannot be opened, a
 * missing geoLocation sheet, an incomplete required header and a book with no valid row at all.
 */
export const parseGeoImportFile = async ( buffer: Buffer ): Promise<ParsedGeoImportFile> => {
    const geoLocations: ParsedGeoLocationRow[] = [];
    const healthFacilities: ParsedHealthFacilityRow[] = [];
    const rejected: RejectedGeoRow[] = [];

    // Whole-book load instead of the streaming WorkbookReader, for the same reason as the two
    // importers before it: the reader of exceljs 4.4.0 resolves the sheet name out of the last entry
    // of the ZIP and throws on any book whose entries do not arrive in the order it assumes — every
    // book with more than one sheet among them, which is every book of this endpoint.
    const workbook = new ExcelJS.Workbook();

    try {
        // exceljs types load() against Buffer<ArrayBuffer> while Node types the multer buffer as
        // Buffer<ArrayBufferLike>. They are the same object at runtime.
        await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch ( error ) {
        throw new GeoImportFileError('The uploaded file could not be read as a .xlsx workbook', error);
    }

    // Sheet 1 is the one the book cannot be without: a load with no geography is not a partial load,
    // it is another file
    let geo;

    try {
        geo = readSheet(workbook, {
            sheet: GEO_LOCATION_SHEET,
            headerAliases: GEO_LOCATION_ALIASES,
            requiredHeaders: GEO_LOCATION_REQUIRED
        });
    } catch ( error ) {
        throw new GeoImportFileError(
            error instanceof XlsxFileError ? error.message : 'The uploaded workbook could not be read',
            error
        );
    }

    if( geo.missingRequiredHeaders.length > 0 ) {
        throw new GeoImportFileError(
            `The geoLocation sheet is missing required headers: ${ geo.missingRequiredHeaders.join(', ') }`
        );
    }

    // Sheet 2 absent is NOT an error: the geography is loaded once and the facilities arrive later,
    // in batches. Its name comes back null so the report says which of the two halves was read
    const hasFacilitySheet = workbook.worksheets
        .some(( sheet ) => normalizeHeader(sheet.name ?? '') === normalizeHeader(HEALTH_FACILITY_SHEET));

    const facility = hasFacilitySheet
        ? readSheet(workbook, {
            sheet: HEALTH_FACILITY_SHEET,
            headerAliases: HEALTH_FACILITY_ALIASES,
            requiredHeaders: HEALTH_FACILITY_REQUIRED
        })
        : null;

    if( facility && facility.missingRequiredHeaders.length > 0 ) {
        throw new GeoImportFileError(
            `The healthFacility sheet is missing required headers: ${ facility.missingRequiredHeaders.join(', ') }`
        );
    }

    readGeoLocationRows(geo.rows, geoLocations, rejected);

    if( facility ) {
        readHealthFacilityRows(facility.rows, healthFacilities, rejected);
    }

    const kept = rejectCycles(geoLocations, rejected);

    // A book that resolves to nothing writable is a content problem and not an empty import: it
    // stops here, before the service opens a single transaction
    if( kept.length === 0 && healthFacilities.length === 0 ) {
        throw new GeoImportFileError('The uploaded workbook carries no valid row');
    }

    // The catalogs sheet needs no branch of its own: sheets are located by name, so one that nobody
    // asks for is never opened and never reaches unknownHeaders. It exists to feed the Excel
    // dropdowns, and the day the importer read from it that sheet would start behaving as authority
    return {
        sheets: { geoLocation: geo.sheet, healthFacility: facility ? facility.sheet : null },
        geoLocations: kept,
        healthFacilities,
        rejected,
        read: { geoLocation: geo.rows.length, healthFacility: facility ? facility.rows.length : 0 },
        missingOptionalHeaders: {
            geoLocation: geo.missingOptionalHeaders,
            healthFacility: facility ? facility.missingOptionalHeaders : []
        },
        unknownHeaders: {
            geoLocation: geo.unknownHeaders,
            healthFacility: facility ? facility.unknownHeaders : []
        }
    };
};
