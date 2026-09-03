import { CreationAttributes, Op, Transaction } from 'sequelize';
import {
    AppError,
    GeoImportFileError,
    esaviLog,
    getMessage,
    buildDifferentialUpdate,
    parseGeoImportFile
} from '../helpers';
import {
    AppDetails,
    AuthUser,
    GeoEntityCounters,
    GeoImportReport,
    GeoRejectionReason,
    ImportGeoDataInput,
    ParsedGeoLocationRow,
    ParsedHealthFacilityRow,
    RejectedGeoRow
} from '../types';
import { CatalogItem, CatalogType, GeoLocation, HealthFacility } from '../models';
import { assertGeoLevelTypesReady } from './geoLocation.service';
import { sequelize } from '../database/connection';

// One transaction per batch and not one for the whole file: a failure leaves the previous batches
// committed, the report says how far it got, and reimporting is idempotent
const IMPORT_BATCH_SIZE = 1000;

// Per SHEET, not per file: a sheet 1 with 300 errors must not leave the errors of sheet 2 invisible
const MAX_REPORTED_IMPORT_ERRORS = 20;

// A dry run writes nothing, so the rows it "would insert" have no UUID. Children resolve against
// this placeholder and count as inserted instead of reading PARENT_NOT_FOUND, which is what makes a
// dry run report what the real run would do
const DRY_RUN_ID_PREFIX = 'dry-run:';

// Code of the catalogType that groups the valid facility types. The importer resolves the type
// against it BEFORE writing: letting TRG_healthFacility_validateCatalogs catch it would abort the
// whole batch with a 500 instead of rejecting one row
const HEALTH_FACILITY_TYPE_CATALOG_CODE = 'healthFacilityType';

// Detail written in appDetails. Both tables carry 'ESAVI-GEOLOC-006', the facilities included: a
// load is a single fact and has to be traceable as one, exactly as F20 wrote ESAVI-CATITEM-006 on
// the catalogType rows it founded
const OPERATION_CODE = 'ESAVI-GEOLOC-006';

const emptyCounters = (): GeoEntityCounters => ({
    read: 0, inserted: 0, updated: 0, unchanged: 0, invalid: 0, duplicated: 0, inactiveMatched: 0
});

/**
 * ESAVI-GEOLOC-006 — Import Geography And Health Facilities Service.
 *
 * Seven phases: the shared precheck, reception, parsing, resolution of the geographic graph with its
 * ORPHAN cascade, the geoLocation batches, the health facilities and the report.
 *
 * What separates this importer from the three before it is that every row points at another row of
 * the same file. Hence the ascending level order — which makes the order of the rows in the sheet
 * irrelevant — and the cascade: without it a rejection at level 2 would leave its parishes hanging
 * from nothing, or would blow up the FK.
 */
const importGeoDataService = async (
    fileBuffer: Buffer | undefined,
    data: ImportGeoDataInput,
    authUser: AuthUser | undefined,
    lang: string
): Promise<GeoImportReport> => {
    // Phase 0 — the precheck, before reading the file. A book loaded against a base with no levels
    // would reject every single row after somebody filled the whole thing in
    const levelTypeIds = await assertGeoLevelTypesReady('GEOLOC_006', lang);

    // Phase 1 — reception. The controller already checks it, and so does this service: it is the
    // only precondition whose absence would reach the parser as a crash instead of as a 400
    if( !fileBuffer ) {
        throw new AppError(getMessage('geoLocation.fileRequired', lang), 400, 'GEOLOC_006_FILE_REQUIRED');
    }
    const dryRun = data.dryRun ?? false;
    const userId = authUser?.userId || 'undefined';

    // Phase 2 — parsing. A rejected row never aborts the process; it is counted and the file goes on
    let parsedFile;
    try {
        parsedFile = await parseGeoImportFile(fileBuffer);
    } catch ( error ) {
        // The four content problems that cut the operation arrive here, and all four cut before any
        // write. Anything else the parser may throw is a defect and stays a 500, so it never
        // disguises itself as a bad file
        if( error instanceof GeoImportFileError ) {
            esaviLog(`ESAVI-GEOLOC-006 - The uploaded file was rejected: ${ error.message }`, 'warn');
            throw new AppError(getMessage('geoLocation.fileInvalid', lang), 400, 'GEOLOC_006_FILE_INVALID', error);
        }
        throw error;
    }
    const { sheets, geoLocations, healthFacilities, rejected, read, rejectedCodes } = parsedFile;

    const geoCounters = { ...emptyCounters(), sortOrderCoerced: 0 };
    const facilityCounters = emptyCounters();

    geoCounters.read = read.geoLocation;
    facilityCounters.read = read.healthFacility;

    // Codes whose row will not be written, from EVERY origin — the parser's cell rejections included.
    // A child of one of them is an ORPHAN and not a row with a parent that is missing from the file
    const rejectedGeoCodes = new Set<string>(rejectedCodes.geoLocation);
    const rejectedFacilityCodes = new Set<string>(rejectedCodes.healthFacility);

    const rejectGeo = ( row: ParsedGeoLocationRow, reason: GeoRejectionReason ): void => {
        rejected.push({ sheet: 'geoLocation', row: row.row, reason });
        rejectedGeoCodes.add(row.externalCode);
    };
    const rejectFacility = ( row: ParsedHealthFacilityRow, reason: GeoRejectionReason ): void => {
        rejected.push({ sheet: 'healthFacility', row: row.row, reason });
        rejectedFacilityCodes.add(row.localCode);
    };

    // externalCode -> geoLocationId of everything already committed: rows found in the base and rows
    // inserted by previous levels. It is what a child resolves its parent against
    const geoIdByCode = new Map<string, string>();
    // externalCode -> level of the same rows, for the PARENT_LEVEL_MISMATCH check
    const geoLevelByCode = new Map<string, number>();
    // externalCode -> isActive, for PARENT_INACTIVE. A row inserted by this import is active by
    // construction; one resolved against the base carries whatever the base says
    const geoActiveByCode = new Map<string, boolean>();

    // ---------------------------------------------------------------------------------------------
    // Phases 3 and 4 — the geographic graph, level by level in ascending order.
    // Levels run in series: level N is committed before level N+1 starts, which is what the
    // FK_geoLocation_parent ON DELETE RESTRICT demands of a bulkCreate of children
    // ---------------------------------------------------------------------------------------------
    const rowsByLevel = new Map<number, ParsedGeoLocationRow[]>();
    for( const row of geoLocations ) {
        const bucket = rowsByLevel.get(row.level);
        if( bucket ) {
            bucket.push(row);
            continue;
        }
        rowsByLevel.set(row.level, [ row ]);
    }
    const levels = [ ...rowsByLevel.keys() ].sort(( first, second ) => first - second);

    const processGeoBatch = async ( batch: ParsedGeoLocationRow[], transaction?: Transaction ): Promise<void> => {
        // The whole row, with no narrowed `attributes` — the precondition of buildDifferentialUpdate —
        // and with NO isActive filter: this is a resolution of identity, not a validation of a FK.
        // The parent is included for its externalCode, which is what PARENT_CHANGED compares against
        const existingRows = await GeoLocation.findAll({
            where: { externalCode: { [Op.in]: batch.map(( row ) => row.externalCode) } },
            include: [ { model: GeoLocation, as: 'parent', attributes: [ 'externalCode' ] } ],
            transaction
        });
        const existingByCode = new Map(existingRows.map(( row ) => [ row.externalCode as string, row ]));

        // The parents of the batch, resolved in ONE query and not one per row. It has to happen
        // before the sibling query below, or a parent that lives only in the base would not be among
        // the ids that query filters by and its name collision would reach the bulkCreate as a 23505.
        // No isActive filter: this is a resolution of identity, not a validation of a FK
        const unresolvedParentCodes = [ ...new Set(
            batch
                .map(( row ) => row.parentCode)
                .filter(( code ): code is string => code !== null && !geoIdByCode.has(code))
        ) ];
        if( unresolvedParentCodes.length > 0 ) {
            const parentRows = await GeoLocation.findAll({
                where: { externalCode: { [Op.in]: unresolvedParentCodes } },
                attributes: [ 'geoLocationId', 'externalCode', 'level', 'isActive' ],
                transaction
            });
            for( const parentRow of parentRows ) {
                const code = parentRow.externalCode as string;
                geoIdByCode.set(code, parentRow.geoLocationId);
                geoLevelByCode.set(code, Number(parentRow.level));
                geoActiveByCode.set(code, parentRow.isActive !== false);
            }
        }

        // Siblings of the batch, to enforce UQ_geoLocation_parent_name before the bulkCreate instead
        // of letting a 23505 bring the whole batch down. The query overselects and the exact match is
        // done in memory, which avoids an Op.or of a thousand conditions Postgres plans badly
        const parentIds = [ ...new Set(
            batch
                .map(( row ) => ( row.parentCode === null ? null : geoIdByCode.get(row.parentCode) ))
                .filter(( id ): id is string => typeof id === 'string' && !id.startsWith(DRY_RUN_ID_PREFIX))
        ) ];
        const siblingRows = parentIds.length === 0 ? [] : await GeoLocation.findAll({
            where: {
                parentGeoLocationId: { [Op.in]: parentIds },
                name: { [Op.in]: [ ...new Set(batch.map(( row ) => row.name)) ] }
            },
            attributes: [ 'geoLocationId', 'parentGeoLocationId', 'name' ],
            transaction
        });
        const siblingOwnerByKey = new Map(siblingRows.map(( row ) => [
            `${ row.parentGeoLocationId }|${ row.name }`, row.geoLocationId
        ]));

        const rowsToInsert: CreationAttributes<GeoLocation>[] = [];
        // Codes of the batch that will exist once it commits, so the next level resolves them
        const pendingIds: [ string, string, number ][] = [];

        for( const row of batch ) {
            const storedRow = existingByCode.get(row.externalCode);
            const isNew = storedRow === undefined;

            // Phase 3.1 — the level type. A level with no geoLevelType rejects its row: the importer
            // founds no catalog, ever
            const geoLevelTypeId = levelTypeIds.get(row.level);
            if( geoLevelTypeId === undefined ) {
                rejectGeo(row, 'GEO_LEVEL_NOT_FOUND');
                continue;
            }

            // Phase 3.2 — the parent, resolved first against the rows of the file already processed
            // and then against the base
            let parentGeoLocationId: string | null = null;
            if( row.parentCode !== null ) {
                // The cascade. It reaches any depth because a rejected code is added to the set the
                // moment its row is turned down, and the levels run in ascending order
                if( rejectedGeoCodes.has(row.parentCode) ) {
                    rejectGeo(row, 'ORPHAN');
                    continue;
                }
                const resolvedParentId = geoIdByCode.get(row.parentCode);
                // Not in the rows of the file already processed and not in the base either
                if( resolvedParentId === undefined ) {
                    rejectGeo(row, 'PARENT_NOT_FOUND');
                    continue;
                }
                // Hanging a NEW geolocation from a deactivated parent is almost always a typo, and the
                // 001 does not allow it either. For an existing row the question does not arise: its
                // parent is never resolved again
                if( isNew && geoActiveByCode.get(row.parentCode) === false ) {
                    rejectGeo(row, 'PARENT_INACTIVE');
                    continue;
                }
                parentGeoLocationId = resolvedParentId;
                const parentLevel = geoLevelByCode.get(row.parentCode);
                if( parentLevel !== undefined && parentLevel !== row.level - 1 ) {
                    rejectGeo(row, 'PARENT_LEVEL_MISMATCH');
                    continue;
                }
            }

            if( !isNew ) {
                // Phase 4.1 — the two rejections of an existing row, BEFORE the diff. Moving a
                // geolocation drags a whole subtree and with it the geographic scope of the users
                // (SPEC F49); changing the level without changing the parent leaves the tree
                // incoherent. Both remain the job of the 004, one row at a time
                const storedParentCode = ( storedRow as GeoLocation & { parent?: { externalCode: string | null } } )
                    .parent?.externalCode ?? null;
                if( ( storedParentCode ?? null ) !== ( row.parentCode ?? null ) ) {
                    rejectGeo(row, 'PARENT_CHANGED');
                    continue;
                }
                if( Number(storedRow.level) !== row.level ) {
                    rejectGeo(row, 'LEVEL_CHANGED');
                    continue;
                }
            }

            // Phase 3.3 — UQ_geoLocation_parent_name. NOT checked at level 1: Postgres treats NULLs as
            // distinct, so the constraint protects nothing there and the row is resolved by
            // externalCode alone
            if( parentGeoLocationId !== null ) {
                const owner = siblingOwnerByKey.get(`${ parentGeoLocationId }|${ row.name }`);
                if( owner !== undefined && owner !== storedRow?.geoLocationId ) {
                    rejectGeo(row, 'SIBLING_NAME_EXISTS');
                    continue;
                }
            }

            if( row.sortOrderCoerced ) {
                geoCounters.sortOrderCoerced++;
            }

            if( isNew ) {
                // Phase 4.2 — insertion. isActive is always true and geoPolygon is never touched: it
                // is not transcribable in a cell and has no column in the file
                const insertId = `${ DRY_RUN_ID_PREFIX }${ row.externalCode }`;
                rowsToInsert.push({
                    geoLevelTypeId,
                    parentGeoLocationId,
                    name: row.name,
                    officialName: row.values.officialName,
                    shortName: row.values.shortName,
                    isoCode: row.values.isoCode,
                    externalCode: row.externalCode,
                    latitude: row.values.latitude,
                    longitude: row.values.longitude,
                    level: row.level,
                    sortOrder: row.values.sortOrder,
                    isActive: true,
                    deletedAt: null,
                    appDetails: [ {
                        createdAt: new Date(),
                        user: userId,
                        method: OPERATION_CODE,
                        detail: 'Geographic location created by bulk import service'
                    } ]
                } as unknown as CreationAttributes<GeoLocation>);
                // The sibling now belongs to this row, so a second row of the batch with the same name
                // under the same parent reads SIBLING_NAME_EXISTS instead of blowing up the bulkCreate
                if( parentGeoLocationId !== null ) {
                    siblingOwnerByKey.set(`${ parentGeoLocationId }|${ row.name }`, insertId);
                }
                pendingIds.push([ row.externalCode, insertId, row.level ]);
                geoActiveByCode.set(row.externalCode, true);
                geoCounters.inserted++;
                continue;
            }

            // Phase 4.3 — the differential update of an existing row
            if( storedRow.isActive === false ) {
                // The row is updated and deliberately NOT reactivated: the file declares no currency,
                // so inferring one would be inventing it. The counter is what keeps that visible
                geoCounters.inactiveMatched++;
            }
            const stored = storedRow.get({ plain: true }) as Record<string, unknown>;
            // externalCode stays out — the row was found BY it. parentGeoLocationId, level and
            // geoLevelTypeId stay out — a change in any of them was rejected above. geoPolygon stays
            // out — it does not travel in the file. isActive and deletedAt stay out — no currency.
            //
            // A column the sheet does not bring enters as undefined and the helper discards it, so the
            // stored value survives; an EMPTY CELL of a column that IS in the sheet proposes null and
            // does empty it. That distinction is the whole reason missingOptionalHeaders is consulted
            // here and not folded into the parser
            const missing = parsedFile.missingOptionalHeaders.geoLocation;
            const fromSheet = <T>( column: string, value: T ): T | undefined =>
                ( missing.includes(column) ? undefined : value );
            const objectToUpdate = buildDifferentialUpdate(stored, {
                name: row.name,
                officialName: fromSheet('officialName', row.values.officialName),
                shortName: fromSheet('shortName', row.values.shortName),
                isoCode: fromSheet('isoCode', row.values.isoCode),
                latitude: fromSheet('latitude', row.values.latitude),
                longitude: fromSheet('longitude', row.values.longitude),
                // Never guarded by truthiness: 0 is false in JavaScript and is also the column
                // default, so that guard would make it impossible to send a row back to position 0
                sortOrder: fromSheet('sortOrder', row.values.sortOrder)
            });
            geoIdByCode.set(row.externalCode, storedRow.geoLocationId);
            geoLevelByCode.set(row.externalCode, Number(storedRow.level));
            geoActiveByCode.set(row.externalCode, storedRow.isActive !== false);
            // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
            if( Object.keys(objectToUpdate).length === 0 ) {
                geoCounters.unchanged++;
                continue;
            }
            geoCounters.updated++;
            if( !dryRun ) {
                const currentAppDetails = Array.isArray(storedRow.appDetails) ? storedRow.appDetails : [];
                const newEntry: AppDetails = {
                    createdAt: new Date(),
                    user: userId,
                    method: OPERATION_CODE,
                    detail: 'Geographic location updated by bulk import service'
                };
                await storedRow.update({
                    ...objectToUpdate,
                    updatedAt: new Date(),
                    appDetails: [ ...currentAppDetails, newEntry ]
                }, { transaction });
            }
        }

        if( rowsToInsert.length > 0 && !dryRun ) {
            const createdRows = await GeoLocation.bulkCreate(rowsToInsert, { transaction });
            for( const created of createdRows ) {
                geoIdByCode.set(created.externalCode as string, created.geoLocationId);
                geoLevelByCode.set(created.externalCode as string, Number(created.level));
            }
            return;
        }
        // Dry run: the file rows themselves stand in for "what would exist", so a child whose parent
        // is also new counts as inserted and not as PARENT_NOT_FOUND
        for( const [ code, id, level ] of pendingIds ) {
            geoIdByCode.set(code, id);
            geoLevelByCode.set(code, level);
        }
    };

    for( const level of levels ) {
        const rowsOfLevel = rowsByLevel.get(level) as ParsedGeoLocationRow[];
        for( let index = 0; index < rowsOfLevel.length; index += IMPORT_BATCH_SIZE ) {
            const batch = rowsOfLevel.slice(index, index + IMPORT_BATCH_SIZE);
            if( dryRun ) {
                await processGeoBatch(batch);
                continue;
            }
            const transaction = await sequelize.transaction();
            try {
                await processGeoBatch(batch, transaction);
                await transaction.commit();
            } catch ( error ) {
                await transaction.rollback();
                // No retry: a unique constraint violation here means two simultaneous imports, which
                // with a SUPERADMIN role is an operation error and is better made visible
                esaviLog(`ESAVI-GEOLOC-006 - geoLocation batch starting at row ${ batch[0].row } failed and was rolled back`, 'error');
                throw new AppError(getMessage('geoLocation.importedFailed', lang), 500, 'GEOLOC_006_IMPORT_FAILED', error);
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Phase 5 — health facilities. Their hierarchy has NO level column, so the order comes out of an
    // iterative walk: each pass takes the rows whose parentLocalCode is empty or already resolved,
    // and it repeats while some pass makes progress
    // ---------------------------------------------------------------------------------------------
    const facilityIdByCode = new Map<string, string>();

    if( healthFacilities.length > 0 ) {
        const facilityByCode = new Map(healthFacilities.map(( row ) => [ row.localCode, row ]));
        // Generations, computed before writing anything: a parent has to be committed before the
        // bulkCreate of its children, exactly as with the levels above
        const generations: ParsedHealthFacilityRow[][] = [];
        const placed = new Set<string>();
        let pending = [ ...healthFacilities ];

        while( pending.length > 0 ) {
            const generation = pending.filter(( row ) =>
                row.parentLocalCode === null
                || placed.has(row.parentLocalCode)
                || !facilityByCode.has(row.parentLocalCode));
            if( generation.length === 0 ) {
                break;
            }
            generation.forEach(( row ) => placed.add(row.localCode));
            generations.push(generation);
            pending = pending.filter(( row ) => !placed.has(row.localCode));
        }

        // What is left when no pass advances any more is a cycle or an orphan, and the two are told
        // apart by walking parentLocalCode over the file itself
        for( const row of pending ) {
            const visited = new Set<string>([ row.localCode ]);
            let current = row.parentLocalCode === null ? undefined : facilityByCode.get(row.parentLocalCode);
            let onCycle = false;
            while( current ) {
                if( visited.has(current.localCode) ) {
                    onCycle = true;
                    break;
                }
                visited.add(current.localCode);
                current = current.parentLocalCode === null ? undefined : facilityByCode.get(current.parentLocalCode);
            }
            rejectFacility(row, onCycle ? 'CYCLE' : 'ORPHAN');
        }

        // The facility types, resolved against the ACTIVE items of the healthFacilityType catalog
        // before writing. Delegating this to TRG_healthFacility_validateCatalogs would abort the batch
        // with a 500 instead of rejecting one row
        const facilityTypeItems = await CatalogItem.findAll({
            where: { isActive: true },
            attributes: [ 'catalogItemId', 'code' ],
            include: [ {
                model: CatalogType,
                as: 'catalogType',
                where: { code: HEALTH_FACILITY_TYPE_CATALOG_CODE },
                attributes: []
            } ]
        });
        const facilityTypeIdByCode = new Map(facilityTypeItems.map(( item ) => [ item.code, item.catalogItemId ]));

        const processFacilityBatch = async ( batch: ParsedHealthFacilityRow[], transaction?: Transaction ): Promise<void> => {
            const existingRows = await HealthFacility.findAll({
                where: { localCode: { [Op.in]: batch.map(( row ) => row.localCode) } },
                include: [
                    { model: GeoLocation, as: 'geoLocation', attributes: [ 'externalCode' ] },
                    { model: HealthFacility, as: 'parent', attributes: [ 'localCode' ] }
                ],
                transaction
            });
            const existingByCode = new Map(existingRows.map(( row ) => [ row.localCode as string, row ]));

            // The geolocations and the parents of the batch, each resolved in one query and not one
            // per row. Everything the geographic half of this import already wrote is in geoIdByCode
            const unresolvedGeoCodes = [ ...new Set(
                batch.map(( row ) => row.geoExternalCode).filter(( code ) => !geoIdByCode.has(code))
            ) ];
            if( unresolvedGeoCodes.length > 0 ) {
                const geoRows = await GeoLocation.findAll({
                    where: { externalCode: { [Op.in]: unresolvedGeoCodes } },
                    attributes: [ 'geoLocationId', 'externalCode' ],
                    transaction
                });
                for( const geoRow of geoRows ) {
                    geoIdByCode.set(geoRow.externalCode as string, geoRow.geoLocationId);
                }
            }
            const unresolvedParentCodes = [ ...new Set(
                batch
                    .map(( row ) => row.parentLocalCode)
                    .filter(( code ): code is string => code !== null && !facilityIdByCode.has(code))
            ) ];
            if( unresolvedParentCodes.length > 0 ) {
                const parentRows = await HealthFacility.findAll({
                    where: { localCode: { [Op.in]: unresolvedParentCodes } },
                    attributes: [ 'healthFacilityId', 'localCode' ],
                    transaction
                });
                for( const parentRow of parentRows ) {
                    facilityIdByCode.set(parentRow.localCode as string, parentRow.healthFacilityId);
                }
            }

            const rowsToInsert: CreationAttributes<HealthFacility>[] = [];
            const pendingIds: [ string, string ][] = [];

            for( const row of batch ) {
                const storedRow = existingByCode.get(row.localCode);
                const isNew = storedRow === undefined;

                // The geolocation the facility hangs from, resolved by externalCode against what the
                // import just wrote and against the base
                const geoLocationId = geoIdByCode.get(row.geoExternalCode);
                if( geoLocationId === undefined ) {
                    rejectFacility(row, 'GEO_NOT_FOUND');
                    continue;
                }
                // A code that does not resolve rejects the row: no catalog is ever founded here
                const facilityTypeItemId = facilityTypeIdByCode.get(row.facilityTypeCode);
                if( facilityTypeItemId === undefined ) {
                    rejectFacility(row, 'FACILITY_TYPE_NOT_FOUND');
                    continue;
                }

                let parentHealthFacilityId: string | null = null;
                if( row.parentLocalCode !== null ) {
                    if( rejectedFacilityCodes.has(row.parentLocalCode) ) {
                        rejectFacility(row, 'ORPHAN');
                        continue;
                    }
                    const resolvedParentId = facilityIdByCode.get(row.parentLocalCode);
                    if( resolvedParentId === undefined ) {
                        rejectFacility(row, 'PARENT_NOT_FOUND');
                        continue;
                    }
                    parentHealthFacilityId = resolvedParentId;
                }

                if( !isNew ) {
                    // The two rejections analogous to those of phase 4. A change of geolocation is a
                    // relocation of the facility and deserves the same caution as a reparenting
                    const joined = storedRow as HealthFacility & {
                        geoLocation?: { externalCode: string | null };
                        parent?: { localCode: string | null };
                    };
                    if( ( joined.parent?.localCode ?? null ) !== row.parentLocalCode ) {
                        rejectFacility(row, 'PARENT_CHANGED');
                        continue;
                    }
                    if( ( joined.geoLocation?.externalCode ?? null ) !== row.geoExternalCode ) {
                        rejectFacility(row, 'LOCATION_CHANGED');
                        continue;
                    }
                }

                if( isNew ) {
                    const insertId = `${ DRY_RUN_ID_PREFIX }${ row.localCode }`;
                    rowsToInsert.push({
                        geoLocationId,
                        parentHealthFacilityId,
                        facilityTypeItemId,
                        localCode: row.localCode,
                        name: row.name,
                        officialName: row.values.officialName,
                        shortName: row.values.shortName,
                        address: row.values.address,
                        latitude: row.values.latitude,
                        longitude: row.values.longitude,
                        phone: row.values.phone,
                        email: row.values.email,
                        isActive: true,
                        deletedAt: null,
                        appDetails: [ {
                            createdAt: new Date(),
                            user: userId,
                            method: OPERATION_CODE,
                            detail: 'Health facility created by bulk import service'
                        } ]
                    } as unknown as CreationAttributes<HealthFacility>);
                    pendingIds.push([ row.localCode, insertId ]);
                    facilityCounters.inserted++;
                    continue;
                }

                if( storedRow.isActive === false ) {
                    facilityCounters.inactiveMatched++;
                }
                const stored = storedRow.get({ plain: true }) as Record<string, unknown>;
                const missing = parsedFile.missingOptionalHeaders.healthFacility;
                const fromSheet = <T>( column: string, value: T ): T | undefined =>
                    ( missing.includes(column) ? undefined : value );
                // localCode stays out — it is the search key. geoLocationId and
                // parentHealthFacilityId stay out — a change in either was rejected above.
                // facilityTypeItemId DOES enter: changing the type of a facility moves nothing of the
                // tree, and its column is mandatory in the sheet
                const objectToUpdate = buildDifferentialUpdate(stored, {
                    facilityTypeItemId,
                    name: row.name,
                    officialName: fromSheet('officialName', row.values.officialName),
                    shortName: fromSheet('shortName', row.values.shortName),
                    address: fromSheet('address', row.values.address),
                    latitude: fromSheet('latitude', row.values.latitude),
                    longitude: fromSheet('longitude', row.values.longitude),
                    phone: fromSheet('phone', row.values.phone),
                    email: fromSheet('email', row.values.email)
                });
                facilityIdByCode.set(row.localCode, storedRow.healthFacilityId);
                if( Object.keys(objectToUpdate).length === 0 ) {
                    facilityCounters.unchanged++;
                    continue;
                }
                facilityCounters.updated++;
                if( !dryRun ) {
                    const currentAppDetails = Array.isArray(storedRow.appDetails) ? storedRow.appDetails : [];
                    const newEntry: AppDetails = {
                        createdAt: new Date(),
                        user: userId,
                        method: OPERATION_CODE,
                        detail: 'Health facility updated by bulk import service'
                    };
                    await storedRow.update({
                        ...objectToUpdate,
                        updatedAt: new Date(),
                        appDetails: [ ...currentAppDetails, newEntry ]
                    }, { transaction });
                }
            }

            if( rowsToInsert.length > 0 && !dryRun ) {
                const createdRows = await HealthFacility.bulkCreate(rowsToInsert, { transaction });
                for( const created of createdRows ) {
                    facilityIdByCode.set(created.localCode as string, created.healthFacilityId);
                }
                return;
            }
            for( const [ code, id ] of pendingIds ) {
                facilityIdByCode.set(code, id);
            }
        };

        for( const generation of generations ) {
            for( let index = 0; index < generation.length; index += IMPORT_BATCH_SIZE ) {
                const batch = generation.slice(index, index + IMPORT_BATCH_SIZE);
                if( dryRun ) {
                    await processFacilityBatch(batch);
                    continue;
                }
                const transaction = await sequelize.transaction();
                try {
                    await processFacilityBatch(batch, transaction);
                    await transaction.commit();
                } catch ( error ) {
                    await transaction.rollback();
                    esaviLog(`ESAVI-GEOLOC-006 - healthFacility batch starting at row ${ batch[0].row } failed and was rolled back`, 'error');
                    throw new AppError(getMessage('geoLocation.importedFailed', lang), 500, 'GEOLOC_006_IMPORT_FAILED', error);
                }
            }
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Phase 6 — the report. errors is trimmed to the first 20 PER SHEET; every counter is the real
    // total. The rejections come from two origins — the parser's and the service's — so they are
    // sorted by row before trimming, and "the first 20" means the first 20 of the sheet
    // ---------------------------------------------------------------------------------------------
    const bySheet = ( sheet: RejectedGeoRow['sheet'] ): RejectedGeoRow[] =>
        rejected.filter(( row ) => row.sheet === sheet).sort(( first, second ) => first.row - second.row);

    const geoRejections = bySheet('geoLocation');
    const facilityRejections = bySheet('healthFacility');

    geoCounters.duplicated = geoRejections.filter(( row ) => row.reason === 'DUPLICATE_IN_FILE').length;
    geoCounters.invalid = geoRejections.length - geoCounters.duplicated;
    facilityCounters.duplicated = facilityRejections.filter(( row ) => row.reason === 'DUPLICATE_IN_FILE').length;
    facilityCounters.invalid = facilityRejections.length - facilityCounters.duplicated;

    return {
        dryRun,
        sheets,
        geoLocation: geoCounters,
        healthFacility: facilityCounters,
        missingOptionalHeaders: parsedFile.missingOptionalHeaders,
        unknownHeaders: parsedFile.unknownHeaders,
        errors: [
            ...geoRejections.slice(0, MAX_REPORTED_IMPORT_ERRORS),
            ...facilityRejections.slice(0, MAX_REPORTED_IMPORT_ERRORS)
        ]
    };
}

export {
    importGeoDataService
}
