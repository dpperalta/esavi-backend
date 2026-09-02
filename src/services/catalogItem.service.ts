import { CreationAttributes, Op, Transaction } from "sequelize";
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, CatalogItemFileError, esaviLog, getMessage, parseCatalogItemsXlsxFile, toCodeFromInput, toCodeFromName, toConstantCase, toTitleCase } from "../helpers";
import { sequelize } from "../database/connection";
import { CatalogItem, CatalogType } from "../models";
import {
    AppDetails,
    AuthUser,
    CatalogItemImportReport,
    CatalogItemSearchInput,
    CreateCatalogItemInput,
    ImportCatalogItemsInput,
    ParsedCatalogItemRow,
    RejectedCatalogItemRow
} from "../types";
import { setEntityActiveStatusService } from "./common/entityActivation.service";
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from "../constants/pagination.constants";

// A configuration catalog is in the order of a couple of thousand items, which is two batches. The
// size is the one the two importers before it already use: the batch is the unit of the transaction,
// so it is also the unit of what survives a failure halfway through
const IMPORT_BATCH_SIZE = 1000;

// The counters stay exact; only the sample of rejected rows is trimmed
const MAX_REPORTED_IMPORT_ERRORS = 20;

// Stands in for the catalogTypeId of a type a dry run would have created. It is deliberately not a
// UUID: it must never reach a query, and the code filters it out before building the IN clause. Its
// only job is to let the rows hanging from a would-be type resolve to something, so they count as
// inserted instead of as an error
const DRY_RUN_TYPE_ID_PREFIX = 'dry-run:';

// varchar(100) of catalogItem.code against varchar(250) of catalogItem.name. A legal name — or a
// legal code sent by the client — can produce an illegal code, and that has to end in a 400 and not
// in the 500 the column would raise
const MAX_CODE_LENGTH = 100;

/**
 * The code of a catalogItem. It comes from the body when the client sends one — normalized into
 * camelCase with toCodeFromInput, which is idempotent, so resending the stored code writes the same
 * value — and only when it is absent is it minted from the name with toCodeFromName. The import
 * (006) has no code column and therefore always mints from the name.
 * Either source can fail to produce a usable code: text made only of separators mints an empty one,
 * and text long enough overflows its own column. Both end in a 400, with a message that names the
 * source the operator actually sent.
 */
const resolveCatalogItemCode = ( source: string, fromBody: boolean, operation: string, lang: string ): string => {
    const code = fromBody ? toCodeFromInput(source) : toCodeFromName(source);

    if( code.length === 0 || code.length > MAX_CODE_LENGTH ) {
        throw new AppError(
            getMessage(fromBody ? 'catalogItem.codeNotValid' : 'catalogItem.codeNotDerivable', lang, {
                code: source.trim(),
                name: source.trim()
            }),
            400,
            `CATITEM_${ operation }_CODE_NOT_${ fromBody ? 'VALID' : 'DERIVABLE' }`
        );
    }

    return code;
}

// The code of a body that may or may not carry one. Null means the body brought no code: the 001
// falls back to the name and the 004 leaves the stored code untouched
const codeFromBody = ( data: Partial<CreateCatalogItemInput>, operation: string, lang: string ): string | null => {
    if( typeof data.code !== 'string' || data.code.trim().length === 0 ) {
        return null;
    }
    return resolveCatalogItemCode(data.code, true, operation, lang);
}

// ESAVI-CATITEM-001 - Create Catalog Item Service
const createCatalogItemService = async (data: CreateCatalogItemInput, authUser: AuthUser | undefined, lang: string) => {
    // Validate that the referenced Catalog Type exists and is active
    const catalogType = await CatalogType.findOne({
        where: {
            catalogTypeId: data.catalogTypeId,
            isActive: true
        }
    });
    if (!catalogType) {
        throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATITEM_001_CATTYPE_NOT_FOUND');
    }
    const catalogTypeId = data.catalogTypeId;
    // Taken from the body when it travels there, and minted from the name only when it does not, so
    // the item never ends up with a placeholder code
    const code = codeFromBody(data, '001', lang) ?? resolveCatalogItemCode(data.name, false, '001', lang);
    // The code must be unique within its Catalog Type: the UNIQUE of the DDL is of the pair
    const existingItem = await CatalogItem.findOne({
        where: {
            catalogTypeId,
            code
        }
    });
    if (existingItem) {
        throw new AppError(getMessage('catalogItem.codeExists', lang, { code, catalogTypeId }), 409, 'CATITEM_001_CODE_EXISTS');
    }
    // Defining sortOrder: if provided in the request, use it. Otherwise, set it to max existing sortOrder + 1 for the same catalogTypeId
    let sortOrder: number | null = null;
    if( data.sortOrder !== undefined ) {
        sortOrder = data.sortOrder;
    } else {
        const maxSortOrder = await CatalogItem.max('sortOrder', {
            where: {
                catalogTypeId: data.catalogTypeId,
            }
        });
        sortOrder = Number(maxSortOrder ?? 0) + 1;
    }
    // Create the Catalog Item
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-CATITEM-001',
        detail: 'Catalog item created by service'
    };
    // isValueLocked is deliberately absent from the input: it is not read from the body, so it always
    // starts false. The lock is placed by the deployment SQL, never by an ADMIN — an item that could
    // be born locked would let the API create the very thing the lock exists to protect from the API
    const createdItem = await CatalogItem.create({
        catalogTypeId: data.catalogTypeId,
        code,
        name: toTitleCase(data.name.trim()),
        // The value belongs to the source code, which resolves items by it, so it is stored in the
        // shape the source code writes it in. The trim comes first: toConstantCase turns the outer
        // whitespace into underscores otherwise
        value: toConstantCase(data.value.trim()),
        description: data.description ? data.description.trim() : null,
        metadata: data.metadata || {},
        sortOrder,
        appDetails: [newEntry]
    });
    return createdItem;
}

// ESAVI-CATITEM-002A - Get Catalog Items by Catalog Type Service
const getActiveCatalogItemsByTypeService = async (catalogTypeId: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    if ( !catalogTypeId ) {
        throw new AppError(getMessage('catalogType.idRequired', 'en'), 400, 'CATITEM_002A_CATTYPEID_REQUIRED');
    }
    const catalogItems = await CatalogItem.findAndCountAll({
        where: {
            catalogTypeId,
            isActive: true
        },
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['sortOrder', 'ASC']],
        limit,
        offset
    });
    return catalogItems;
}

// ESAVI-CATITEM-002B - Get All Catalog Items by Catalog Type Service (including inactive) - For SuperAdmin
const getAllCatalogItemsByTypeService = async (catalogTypeId: string = '', limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET, isAdmin: boolean = false) => {
    let whereClause = {};
    if( isAdmin && catalogTypeId ) {
        whereClause = { catalogTypeId };
    } else if( !isAdmin && catalogTypeId ) {
        whereClause = { catalogTypeId, isActive: true };
    }
    const catalogItems = await CatalogItem.findAndCountAll({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [
            ['sortOrder', 'ASC'],
            ['name', 'ASC']
        ],
        limit,
        offset
    });
    return catalogItems;
}

// ESAVI-CATITEM-007 - Search Catalog Items by Name or Code Service
// The global search of catalogItem, SPEC F52: no catalogTypeId required in the path, unlike the
// 002A/002B. catalogTypeId is optional here and only narrows — it never substitutes the text
// criterion, which is why the guard lives in the service and not only in the validator:
// `optional()` cannot express "at least one of the two".
// catalogItem.code is not unique globally — UQ_catalogItem_type_code is composite — so this
// returns { count, rows } like any listing, never a single object
const searchCatalogItemsService = async (
    filters: CatalogItemSearchInput,
    lang: string,
    includeInactive: boolean = false,
    limit: number = DEFAULT_LIMIT,
    offset: number = DEFAULT_OFFSET
) => {
    const textConditions = [
        ...buildTextSearchConditions(filters.name, ['name']),
        ...buildTextSearchConditions(filters.code, ['code'])
    ];
    if( textConditions.length === 0 ) {
        throw new AppError(getMessage('catalogItem.searchCriteriaRequired', lang), 400, 'CATITEM_007_SEARCH_CRITERIA_REQUIRED');
    }
    const whereClause: Record<string, unknown> = { [Op.or]: textConditions };
    if( filters.catalogTypeId ) {
        whereClause.catalogTypeId = filters.catalogTypeId;
    }
    if( !includeInactive ) {
        whereClause.isActive = true;
    }
    const catalogItems = await CatalogItem.findAndCountAll({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        include: [
            {
                model: CatalogType,
                as: 'catalogType',
                attributes: ['catalogTypeId', 'name']
            }
        ],
        order: [
            ['sortOrder', 'ASC'],
            ['name', 'ASC']
        ],
        limit,
        offset
    });
    return catalogItems;
}

// ESAVI-CATITEM-003 - Get Catalog Item by ID Service
const getCatalogItemByIdService = async (id: string, lang: string, isAdmin: boolean = false) => {
    const whereClause = isAdmin ? { catalogItemId: id } : { catalogItemId: id, isActive: true };
    const catalogItem = await CatalogItem.findOne({
        where: whereClause,
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] }
    });
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_003_NOT_FOUND');
    }
    return catalogItem;
}

// ESAVI-CATITEM-004 - Update Catalog Item Service - For SuperAdmin
const updateCatalogItemService = async (id: string, data: Partial<CreateCatalogItemInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const catalogItem = await CatalogItem.findByPk(id);
    let updatedCatalogItem = catalogItem;
    if (!catalogItem) {
        throw new AppError(getMessage('catalogItem.notFound', lang), 404, 'CATITEM_004_NOT_FOUND');
    }
    // Validate that the referenced Catalog Type exists and is active before moving the item
    let targetCatalogTypeId = catalogItem.catalogTypeId;
    if( data.catalogTypeId && data.catalogTypeId !== catalogItem.catalogTypeId ) {
        const catalogType = await CatalogType.findOne({
            where: {
                catalogTypeId: data.catalogTypeId,
                isActive: true
            }
        });
        if (!catalogType) {
            throw new AppError(getMessage('catalogType.notFound', lang), 404, 'CATITEM_004_CATTYPE_NOT_FOUND');
        }
        targetCatalogTypeId = data.catalogTypeId;
    }
    // The code is written exactly when it travels in the body, and it is never re-minted from a name
    // that changed: renaming an item does not move its code, so a code chosen by hand survives the
    // rename and whatever resolves against it keeps resolving
    const sentCode = codeFromBody(data, '004', lang);
    const targetCode = sentCode ?? catalogItem.code;
    // The code must be unique within the target Catalog Type, which may differ from the current one
    if( targetCode && ( targetCode !== catalogItem.code || targetCatalogTypeId !== catalogItem.catalogTypeId ) ) {
        const existingItem = await CatalogItem.findOne({
            where: {
                code: targetCode,
                catalogTypeId: targetCatalogTypeId,
                catalogItemId: { [Op.ne]: id }
            }
        });
        if( existingItem ) {
            throw new AppError(getMessage('catalogItem.codeExists', lang, { code: targetCode, catalogTypeId: targetCatalogTypeId }), 409, 'CATITEM_004_CODE_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(catalogItem.appDetails) ? catalogItem.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. The comparison lives in
    // buildDifferentialUpdate, whose stored side has to be the whole row — findByPk reads it
    // without narrowed attributes, which is the precondition of the helper
    const stored = catalogItem.get({ plain: true }) as Record<string, unknown>;
    // A locked value belongs to the source code, which resolves items by it, so no request can move
    // it: the field never enters the diff, whether it travels or not and whatever it carries. It is a
    // silent omission and not a 400 or a 409 — the same shape notificationMedication already applies
    // to sortOrder — and isValueLocked travels in the read responses so a client can tell beforehand.
    // Everything else stays editable: the country recoding the item is the very scenario this protects
    const isValueLocked = stored.isValueLocked === true;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        catalogTypeId: targetCatalogTypeId,
        // A field of its own again: it enters the diff exactly when the body carries it, and
        // reaches the UPDATE only if it changed
        code: sentCode ?? undefined,
        name: data.name ? toTitleCase(data.name.trim()) : undefined,
        value: isValueLocked
            ? undefined
            : ( data.value !== undefined ? ( data.value ? toConstantCase(data.value.trim()) : null ) : undefined ),
        description: data.description ? data.description.trim() : undefined,
        metadata: data.metadata ? data.metadata : undefined,
        sortOrder: data.sortOrder ? data.sortOrder : undefined
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry
    if( Object.keys(objectToUpdate).length > 0 ) {
        const newEntry: AppDetails = {
            createdAt: new Date(),
            user: userId || 'undefined',
            method: 'ESAVI-CATITEM-004',
            detail: 'Catalog item updated by service'
        };
        updatedCatalogItem = await catalogItem.update({
            ...objectToUpdate,
            updatedAt: new Date(),
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, {returning: true});
    }
    return updatedCatalogItem;
}

// ESAVI-CATITEM-005A / 005B - Setting Catalog Item Active/Inactive Service - For SuperAdmin
const setCatalogItemActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    // A locked item cannot be withdrawn: if the source code names it, the source code needs it, and
    // retiring it is a change of spec rather than an act of administration. The check runs before the
    // one for alreadyInactive so the message states the real cause, and only on the way out — 005B is
    // unreachable for a locked item, which by construction never gets to be inactive
    if( !isActive ) {
        const stored = await CatalogItem.findByPk(id);
        if( stored?.isValueLocked ) {
            throw new AppError(
                getMessage('catalogItem.valueLocked', lang, { id, value: stored.value }),
                409,
                'CATITEM_005A_VALUE_LOCKED'
            );
        }
    }
    const transaction = await sequelize.transaction();
    try {
        const catalogItem = await setEntityActiveStatusService({
            model: CatalogItem,
            where: { catalogItemId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('catalogItem.notFound', lang),
            notFoundCode: `CATITEM_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`catalogItem.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `CATITEM_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-CATITEM-${ op }`,
                detail: `CatalogItem ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return catalogItem;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-CATITEM-006 - Import Catalog Items Service
const importCatalogItemsService = async (
    fileBuffer: Buffer | undefined,
    data: ImportCatalogItemsInput,
    authUser: AuthUser | undefined,
    lang: string
): Promise<CatalogItemImportReport> => {
    // Phase 1 — reception. The controller already checks it, and so does this service: it is the
    // only precondition whose absence would reach the parser as a crash instead of as a 400
    if (!fileBuffer) {
        throw new AppError(getMessage('catalogItem.fileRequired', lang), 400, 'CATITEM_006_FILE_REQUIRED');
    }
    const dryRun = data.dryRun ?? false;
    const userId = authUser?.userId || 'undefined';

    // Phase 2 — parsing. A rejected row never aborts the process; it is counted and the file goes on
    let parsedFile;
    try {
        parsedFile = await parseCatalogItemsXlsxFile(fileBuffer);
    } catch (error) {
        // Only a book that cannot be opened or carries no sheet arrives here as a 400. Anything else
        // the parser may throw is a defect and stays a 500, so it never disguises itself as a bad file
        if (error instanceof CatalogItemFileError) {
            throw new AppError(getMessage('catalogItem.fileInvalid', lang), 400, 'CATITEM_006_FILE_INVALID', error);
        }
        throw error;
    }
    const { sheet, rows, rejected, missingOptionalHeaders, unknownHeaders, missingRequiredHeaders } = parsedFile;

    // A missing required header cuts before a single data row was read, and therefore before anything
    // could be written in either of the two tables. The list of what is missing travels in the AppError
    if (missingRequiredHeaders.length > 0) {
        esaviLog(`ESAVI-CATITEM-006 - Required headers missing from the uploaded file: ${ missingRequiredHeaders.join(', ') }`, 'warn');
        throw new AppError(
            getMessage('catalogItem.fileInvalid', lang),
            400,
            'CATITEM_006_FILE_INVALID',
            new Error(`Missing required headers: ${ missingRequiredHeaders.join(', ') }`)
        );
    }
    // Fully empty rows are neither read nor invalid, so every counted row ended in one of the two
    // lists. It is fixed here, before phase 3 starts pushing its own rejections into `rejected`:
    // a row the service turns down was still read, and read must not grow because of it
    const read = rows.length + rejected.length;
    // The other content problem that cuts the operation, and it also cuts before writing: a book with
    // the right header and not one usable row
    if (rows.length === 0) {
        throw new AppError(
            getMessage('catalogItem.fileInvalid', lang),
            400,
            'CATITEM_006_FILE_INVALID',
            new Error('The file produced no valid row')
        );
    }

    // The type cache spans the whole import and not the batch. A new type appearing in 40 rows split
    // across two batches has to be created once: a per-batch cache would try twice and the second
    // attempt would hit UQ_catalogType_code inside a transaction, dragging the whole batch with it
    const typeIdByCode = new Map<string, string>();
    let catalogTypesCreated = 0;
    let sortOrderCoerced = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    // Phase 3 — type resolution. Returns the codes of the batch that could not be resolved, whose
    // rows the caller then turns down: this is the only rejection the service emits and the parser
    // cannot, because the parser is pure and does not know what exists
    const resolveTypes = async (batch: ParsedCatalogItemRow[], transaction?: Transaction): Promise<Set<string>> => {
        const pendingCodes = [ ...new Set(batch.map(row => row.catalogTypeCode)) ]
            .filter(code => !typeIdByCode.has(code));
        const unresolved = new Set<string>();
        if (pendingCodes.length === 0) {
            return unresolved;
        }
        // No isActive filter: an inactive type still occupies its code and still serves to hang items
        // from. Reusing it does not reactivate it — the file declares no currency
        const existingTypes = await CatalogType.findAll({
            where: { code: { [Op.in]: pendingCodes } },
            transaction
        });
        for (const existingType of existingTypes) {
            typeIdByCode.set(existingType.code, existingType.catalogTypeId);
        }

        for (const code of pendingCodes) {
            if (typeIdByCode.has(code)) {
                continue;
            }
            // The file brings the name, so there is something to create the type with. A typo in
            // catalogTypeCode does not fail here: it founds a type nobody asked for, which is the
            // assumed cost of creating on the fly and the reason catalogTypesCreated travels in the
            // response instead of only in the log
            const namedRow = batch.find(row => row.catalogTypeCode === code && row.catalogTypeName !== null);
            if (!namedRow) {
                unresolved.add(code);
                continue;
            }
            catalogTypesCreated++;
            // A dry run creates nothing: the rows hanging from this code resolve against the cache so
            // they count as inserted, and the counter reports what would have been created
            if (dryRun) {
                typeIdByCode.set(code, `${ DRY_RUN_TYPE_ID_PREFIX }${ code }`);
                continue;
            }
            // Inside the batch transaction and before the bulkCreate of items, because the FK is
            // ON DELETE RESTRICT and the type has to exist first. This is the only write of this
            // service outside catalogItem, and an insertion — never a differential update: an
            // existing type is never touched, however different its catalogTypeName in the file
            const createdType = await CatalogType.create({
                code,
                name: namedRow.catalogTypeName as string,
                isActive: true,
                deletedAt: null,
                appDetails: [{
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-CATITEM-006',
                    detail: 'Catalog type created on the fly by bulk import service'
                }]
            }, { transaction });
            typeIdByCode.set(code, createdType.catalogTypeId);
        }
        return unresolved;
    }

    // Phase 4 — one batch at a time. Reading the existing rows and computing the diff happens the
    // same way in both modes; `transaction` is undefined on a dry run, where nothing is written
    const processBatch = async (batch: ParsedCatalogItemRow[], transaction?: Transaction): Promise<void> => {
        const unresolved = await resolveTypes(batch, transaction);
        const usableRows: ParsedCatalogItemRow[] = [];
        for (const row of batch) {
            if (unresolved.has(row.catalogTypeCode)) {
                rejected.push({ row: row.row, reason: 'CATALOG_TYPE_NAME_REQUIRED' });
                continue;
            }
            usableRows.push(row);
        }
        if (usableRows.length === 0) {
            return;
        }
        // Counted over the rows that actually reach a table, so a row turned down in phase 3 does not
        // report a coercion that never landed anywhere
        sortOrderCoerced += usableRows.filter(row => row.sortOrderCoerced).length;

        const catalogTypeIds = [ ...new Set(usableRows.map(row => typeIdByCode.get(row.catalogTypeCode) as string)) ]
            .filter(catalogTypeId => !catalogTypeId.startsWith(DRY_RUN_TYPE_ID_PREFIX));
        // The whole row, with no narrowed `attributes` — the precondition of buildDifferentialUpdate —
        // and with no isActive filter, because an inactive item still occupies its half of the pair.
        // The query overselects: catalogTypeId IN (...) AND code IN (...) brings back pairs the file
        // does not carry. The exact match is done in memory over `${catalogTypeId}|${code}`, which is
        // what avoids an Op.or of a thousand conditions that Postgres plans badly
        const existingItems = catalogTypeIds.length === 0 ? [] : await CatalogItem.findAll({
            where: {
                catalogTypeId: { [Op.in]: catalogTypeIds },
                code: { [Op.in]: [ ...new Set(usableRows.map(row => row.code)) ] }
            },
            transaction
        });
        const existingByPair = new Map(existingItems.map(item => [ `${ item.catalogTypeId }|${ item.code }`, item ]));
        const itemsToInsert: CreationAttributes<CatalogItem>[] = [];

        for (const row of usableRows) {
            const catalogTypeId = typeIdByCode.get(row.catalogTypeCode) as string;
            const storedItem = existingByPair.get(`${ catalogTypeId }|${ row.code }`);
            if (!storedItem) {
                // Phase 5 — insertion. metadata is not written and stays with the '{}' of the DDL: in
                // this entity it is a business field the client writes with the 001 and the 004, not a
                // slot reserved for provenance. isActive is always true — the .xlsx declares no
                // currency, so inferring one from the file would be inventing it
                itemsToInsert.push({
                    catalogTypeId,
                    code: row.code,
                    name: row.name,
                    // Same shape the 001 and the 004 store: the import is a third way into the column
                    // and must not be the one that leaves it unnormalized. An inserted item is new, so
                    // there is no lock to respect — isValueLocked stays with the false of the DDL
                    value: toConstantCase(row.values.value),
                    description: row.values.description,
                    sortOrder: row.values.sortOrder,
                    isActive: true,
                    deletedAt: null,
                    appDetails: [{
                        createdAt: new Date(),
                        user: userId,
                        method: 'ESAVI-CATITEM-006',
                        detail: 'Catalog item created by bulk import service'
                    }]
                } as CreationAttributes<CatalogItem>);
                continue;
            }
            const stored = storedItem.get({ plain: true }) as Record<string, unknown>;
            // The four columns the file is the complete source of, each one entering with no presence
            // check: there is no client body to ask, and it is the helper that decides whether there
            // is an UPDATE. sortOrder is never guarded by truthiness — 0 is false in JavaScript and is
            // also the column default, so that guard would make it impossible to send an item back to
            // position 0 by import.
            // catalogTypeId and code stay out — the row was found *by* the pair. metadata stays out —
            // it belongs to the client and must survive a reimport. isActive and deletedAt stay out —
            // the file declares no currency, so a deactivated item stays deactivated
            // The most dangerous path of the four: a bulk import would rewrite the whole catalog in a
            // single pass. On a locked target the value is dropped and every other column is applied.
            // The row is not rejected and does not swell `rejected` — it is not an error in the file,
            // it is a column that cannot be written
            const objectToUpdate = buildDifferentialUpdate(stored, {
                name: row.name,
                value: stored.isValueLocked === true ? undefined : toConstantCase(row.values.value),
                description: row.values.description,
                sortOrder: row.values.sortOrder
            });
            // Nothing changed: no UPDATE, no updatedAt, no appDetails entry and no sysDetails event
            if (Object.keys(objectToUpdate).length === 0) {
                unchanged++;
                continue;
            }
            updated++;
            if (!dryRun) {
                const currentAppDetails = Array.isArray(storedItem.appDetails) ? storedItem.appDetails : [];
                const newEntry: AppDetails = {
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-CATITEM-006',
                    detail: 'Catalog item updated by bulk import service'
                };
                await storedItem.update({
                    ...objectToUpdate,
                    updatedAt: new Date(),
                    appDetails: [
                        ...currentAppDetails,
                        newEntry
                    ]
                }, { transaction });
            }
        }

        if (itemsToInsert.length > 0) {
            inserted += itemsToInsert.length;
            // No updateOnDuplicate and no ignoreDuplicates: the previous SELECT already told apart
            // what is new, and updateOnDuplicate would overwrite appDetails and metadata of the
            // existing rows and write even when nothing changed
            if (!dryRun) {
                await CatalogItem.bulkCreate(itemsToInsert, { transaction });
            }
        }
    }

    for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(index, index + IMPORT_BATCH_SIZE);
        // A dry run opens no transaction at all: there is nothing to roll back, in either table
        if (dryRun) {
            await processBatch(batch);
            continue;
        }
        // One transaction per batch instead of one for the whole file: a failure leaves the previous
        // ones committed and the report says how far it got, and reimporting is idempotent
        const transaction = await sequelize.transaction();
        try {
            await processBatch(batch, transaction);
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            // No retry: a unique constraint violation here means two simultaneous imports, which with
            // a SUPERADMIN role is an operation error and is better made visible
            esaviLog(`ESAVI-CATITEM-006 - Batch starting at row ${ batch[0].row } failed and was rolled back`, 'error');
            throw new AppError(getMessage('catalogItem.importedFailed', lang), 500, 'CATITEM_006_IMPORT_FAILED', error);
        }
    }

    // Phase 6 — report. errors is trimmed to the first 20 entries; the counters are the real totals.
    // The rejections come from two origins — the parser's and phase 3's — so they are sorted by row
    // before trimming, and "the first 20" means the first 20 of the sheet and not of the parse order
    const duplicated = rejected.filter(row => row.reason === 'DUPLICATE_IN_FILE').length;
    const invalid = rejected.length - duplicated;
    const errors: RejectedCatalogItemRow[] = [ ...rejected ]
        .sort((first, second) => first.row - second.row)
        .slice(0, MAX_REPORTED_IMPORT_ERRORS);

    return {
        read,
        inserted,
        updated,
        unchanged,
        invalid,
        duplicated,
        catalogTypesCreated,
        sortOrderCoerced,
        dryRun,
        sheet,
        missingOptionalHeaders,
        unknownHeaders,
        errors
    };
}

export {
    createCatalogItemService,
    getActiveCatalogItemsByTypeService,
    getAllCatalogItemsByTypeService,
    searchCatalogItemsService,
    getCatalogItemByIdService,
    updateCatalogItemService,
    setCatalogItemActivationService,
    importCatalogItemsService
}