// The types of ESAVI-GEOLOC-006 and ESAVI-GEOLOC-007. They live in a file of their own, and not in
// geoLocation.types.ts, because they describe the two entities at once: a single load writes the
// geographic tree and the facility register, and its report counts them side by side.
// No Update...Input is declared here — §4 of the conventions — and ImportGeoDataInput carries no
// dictionaryVersion: neither table has a metadata column where it could be kept

// dryRun walks, resolves and counts without opening a single transaction. Default false, the same
// as the three importers before it: that the first pass be dry is the frontend's decision, not the
// server's
export interface ImportGeoDataInput {
    dryRun?: boolean;
}

// includeExisting dumps the rows already loaded into sheets 1 and 2, and only the active ones. It is
// what turns the pair of endpoints into the ordinary maintenance of the geography: download, fix
// twelve rows, upload, and the differential update writes only those twelve
export interface GenerateGeoTemplateInput {
    includeExisting?: boolean;
}

// One accepted row of sheet 1. row is 1-based over the sheet, so the number points at the cell the
// way the operator sees it in Excel; row 1 is the header.
// Unlike catalogItem, nothing here is normalized beyond .trim(): createGeoLocationService applies
// neither toTitleCase to the name nor toConstantCase to the code, and an importer that normalized
// would create rows the 001 could not find again.
// geoLevelTypeId is absent on purpose — it never travels in the file and the service resolves it
// from level, through geoLevelType.sortOrder
export interface ParsedGeoLocationRow {
    row: number;
    // The identity of the row, and the target of every parentCode
    externalCode: string;
    // Null only at level 1, where the row is a root
    parentCode: string | null;
    name: string;
    level: number;
    values: {
        officialName: string | null;
        shortName: string | null;
        isoCode: string | null;
        latitude: number | null;
        longitude: number | null;
        // Already coerced into a valid smallint, so the service has no branch for it
        sortOrder: number;
    };
    // The cell was empty or invalid and entered as 0. Counted so the coercion is never silent
    sortOrderCoerced: boolean;
}

// One accepted row of sheet 2. This one does normalize, because that is what healthFacility's own
// 001 has done since SPEC 09: toConstantCase on the code and toTitleCase on the name.
// The three ...Code fields are what the service resolves against the database; the UUIDs they turn
// into never travel in the file
export interface ParsedHealthFacilityRow {
    row: number;
    // The identity of the row. UQ_healthFacility_localCode makes it unique across the whole table
    localCode: string;
    name: string;
    geoExternalCode: string;
    facilityTypeCode: string;
    // Null when the cell is empty: a facility with no parent is legitimate
    parentLocalCode: string | null;
    values: {
        officialName: string | null;
        shortName: string | null;
        address: string | null;
        latitude: number | null;
        longitude: number | null;
        phone: string | null;
        email: string | null;
    };
}

// Why a row was not written. Eleven of these the service emits and not the parser — GEO_LEVEL_NOT_
// FOUND, PARENT_NOT_FOUND, PARENT_INACTIVE, PARENT_LEVEL_MISMATCH, SIBLING_NAME_EXISTS,
// PARENT_CHANGED, LEVEL_CHANGED, ORPHAN, GEO_NOT_FOUND, FACILITY_TYPE_NOT_FOUND and
// LOCATION_CHANGED — because every one of them depends on the state of the database and the parser
// is pure.
// ORPHAN is the reason that has no equivalent in the three importers before this one: it is the
// cascade, and it always appears in bulk, because a single rejection upstream brings down a whole
// branch
export type GeoRejectionReason =
    | 'EMPTY_EXTERNAL_CODE' | 'EMPTY_NAME' | 'EMPTY_LEVEL' | 'INVALID_LEVEL'
    | 'MISSING_PARENT_CODE' | 'UNEXPECTED_PARENT_CODE'
    | 'DUPLICATE_IN_FILE' | 'VALUE_TOO_LONG' | 'CYCLE'
    | 'GEO_LEVEL_NOT_FOUND' | 'PARENT_NOT_FOUND' | 'PARENT_INACTIVE'
    | 'PARENT_LEVEL_MISMATCH' | 'SIBLING_NAME_EXISTS'
    | 'PARENT_CHANGED' | 'LEVEL_CHANGED' | 'ORPHAN'
    | 'EMPTY_LOCAL_CODE' | 'EMPTY_FACILITY_TYPE' | 'EMPTY_GEO_CODE'
    | 'GEO_NOT_FOUND' | 'FACILITY_TYPE_NOT_FOUND' | 'LOCATION_CHANGED';

// One rejected row. sheet is what makes a row number readable: the two sheets number from 1 and
// without it row 7 names two different cells. column is filled only for VALUE_TOO_LONG — the other
// reasons name their column already
export interface RejectedGeoRow {
    sheet: 'geoLocation' | 'healthFacility';
    row: number;
    reason: GeoRejectionReason;
    column?: string;
}

// The counters of one table. They close: read = inserted + updated + unchanged + invalid +
// duplicated, and every one of them counts the real total even though errors is trimmed.
// inactiveMatched is the counter the earlier importers do not have: it says how many rows of the
// file resolved against a deactivated row that was updated and deliberately not reactivated
export interface GeoEntityCounters {
    read: number;
    inserted: number;
    updated: number;
    unchanged: number;
    invalid: number;
    duplicated: number;
    inactiveMatched: number;
}

// What the import returns instead of a resource: the report of a process. There is not a single
// geoLocationId or healthFacilityId in it, which is why the operation answers 200 and not 201.
// sheets.healthFacility comes back null when the book carries only sheet 1, which is a legitimate
// partial load and not an error.
// errors is trimmed to the first 20 per sheet, and not 20 in total: a broken sheet 1 must not leave
// the errors of sheet 2 invisible
export interface GeoImportReport {
    dryRun: boolean;
    sheets: { geoLocation: string; healthFacility: string | null };
    geoLocation: GeoEntityCounters & { sortOrderCoerced: number };
    healthFacility: GeoEntityCounters;
    missingOptionalHeaders: { geoLocation: string[]; healthFacility: string[] };
    unknownHeaders: { geoLocation: string[]; healthFacility: string[] };
    errors: RejectedGeoRow[];
}
