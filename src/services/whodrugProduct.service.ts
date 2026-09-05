import { CreationAttributes, Op, QueryTypes, Transaction, WhereOptions } from 'sequelize';
import { sequelize } from '../database/connection';
import { WhodrugProduct } from '../models';
import { AppError, buildDifferentialUpdate, buildTextSearchConditions, esaviLog, flattenWhodrugProducts, getMessage, toWhodrugSearchForm } from '../helpers';
import { escapeLike } from '../helpers/stringHandling.helper';
import { getAppConfigBoolean, getAppConfigJson, getAppConfigString } from '../helpers/appConfig.helper';
import {
    AppDetails,
    AuthUser,
    RejectedWhodrugProduct,
    SyncWhodrugProductsInput,
    WhodrugApiDrug,
    WhodrugDownloadConfig,
    WhodrugProductFlatRow,
    WhodrugProductListFilters,
    WhodrugProductSyncReport,
    WhodrugSearchOption,
    WhodrugSearchPolicy
} from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import {
    WHODRUG_BATCH_SIZE,
    WHODRUG_CLIENT_KEY_CODE,
    WHODRUG_CLIENT_KEY_HEADER,
    WHODRUG_DOWNLOAD_PARAMS_CODE,
    WHODRUG_DOWNLOAD_TIMEOUT_MS,
    WHODRUG_DOWNLOAD_URL_CODE,
    WHODRUG_ENABLED_CODE,
    WHODRUG_LICENSE_KEY_CODE,
    WHODRUG_LICENSE_KEY_HEADER,
    WHODRUG_SCOPE,
    WHODRUG_SEARCH_COUNTRY_CODE,
    WHODRUG_SEARCH_EXCLUDED_ATC_CODE
} from '../constants/whodrug.constants';

// SPEC F56 — the raw mirror of the WHODrug standard. name and ingredient are independent filters,
// not alternatives of a single search box: both narrow the result when both travel. ingredient
// queries ingredient AND ingredientTranslations at once, joined by Op.or, so an operator can type
// either the English principle or its Spanish translation
const buildWhodrugProductAdminWhere = (filters: WhodrugProductListFilters): WhereOptions => {
    const where: Record<string, unknown> = {};

    const nameConditions = buildTextSearchConditions(filters.name, ['drugName']);
    if (nameConditions.length > 0) {
        Object.assign(where, nameConditions[0]);
    }

    const ingredientConditions = buildTextSearchConditions(filters.ingredient, ['ingredient', 'ingredientTranslations']);
    if (ingredientConditions.length > 0) {
        where[Op.or as unknown as string] = ingredientConditions;
    }

    return where;
}

// ESAVI-WHODPROD-002B - Get All Whodrug Products Service (inspection listing, admin only)
//
// This is the raw mirror, exactly as registered: vaccines included, no ATC exclusion and no
// country filter. Inactive rows are returned too — 002B is the administration variant and the
// route already gates it to ADMIN, which is what canViewInactive would otherwise decide
const getAllWhodrugProductsService = async (filters: WhodrugProductListFilters) => {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const offset = filters.offset ?? DEFAULT_OFFSET;

    const whodrugProducts = await WhodrugProduct.findAndCountAll({
        where: buildWhodrugProductAdminWhere(filters),
        // sysDetails is internal and never exposed by the API
        attributes: { exclude: ['sysDetails'] },
        order: [['drugName', 'ASC'], ['drugCode', 'ASC']],
        limit,
        offset
    });

    return whodrugProducts;
}

// ---------------------------------------------------------------------------------------------
// SPEC F56 §3.5 — ESAVI-WHODPROD-007: sync the mirror from the UMC regional-drugs API
// ---------------------------------------------------------------------------------------------

// What `appConfig.helper.ts` throws when there is neither a usable row nor an environment
// variable. The service replaces it with a 503: that WHODrug is unconfigured is not a server
// fault, it is a service this deployment does not offer
const MISSING_CONFIG_CODE = 'APPCONFIG_VALUE_MISSING';

// The only precondition that would otherwise pile two syncs' logical deletions on top of one
// another. A process-memory flag, exactly like SPEC F19's single-file import has no need for but
// this endpoint does: two downloads running at once would race each other's deactivation pass
let isSyncRunning = false;

// The counters stay exact; only the sample of rejected rows is trimmed
const MAX_REPORTED_SYNC_ERRORS = 20;

// varchar widths of the whodrugProduct DDL (SPEC F56 §3.1). The text columns are absent on
// purpose: they carry no ceiling because the column declares none
const COLUMN_MAX_LENGTHS: Partial<Record<keyof WhodrugProductFlatRow, number>> = {
    drugCode: 50,
    medicinalProductId: 250,
    atcs: 250,
    languageCode: 10,
    iso3Code: 3,
    countryMedicinalProductId: 250,
    maHoldersMedicinalProductId: 250,
    formMedicinalProductId: 250,
    strengthMedicinalProductId: 250,
    optionName: 500,
    optionNameSearch: 500
};

// §3.5 point 2 — the four reads of scope WHODRUG, with the SPEC F43 precedence: the systemConfig
// row wins and .env is the fallback. Resolved on every sync and never cached: turning the switch
// off, or rotating a credential, must not wait for a restart
const resolveWhodrugDownloadConfig = async (lang: string): Promise<WhodrugDownloadConfig> => {
    try {
        const [ clientKey, licenseKey, downloadUrl, downloadParams ] = await Promise.all([
            getAppConfigString(WHODRUG_CLIENT_KEY_CODE, WHODRUG_SCOPE, lang),
            getAppConfigString(WHODRUG_LICENSE_KEY_CODE, WHODRUG_SCOPE, lang),
            getAppConfigString(WHODRUG_DOWNLOAD_URL_CODE, WHODRUG_SCOPE, lang),
            getAppConfigJson<Record<string, string>>(WHODRUG_DOWNLOAD_PARAMS_CODE, WHODRUG_SCOPE, lang)
        ]);
        return { clientKey, licenseKey, downloadUrl, downloadParams };
    } catch (error) {
        if (error instanceof AppError && error.code === MISSING_CONFIG_CODE) {
            // The resolved object is never logged: it carries the two licence credentials
            esaviLog(`[ERROR]: ESAVI-WHODPROD-007 - WHODrug sync is enabled but not configured: ${ error.message }`, 'error');
            throw new AppError(getMessage('whodrugProduct.notConfigured', lang), 503, 'WHODPROD_007_NOT_CONFIGURED', error);
        }
        throw error;
    }
}

// §3.5 point 3 — the single outbound call, with the ceiling enforced by an AbortController.
// A non-2xx answer, a body that is not an array, or a timeout are all the same 502: the API did
// not hand back a usable standard
const downloadWhodrugStandard = async (config: WhodrugDownloadConfig, lang: string): Promise<WhodrugApiDrug[]> => {
    const url = new URL(config.downloadUrl);
    for (const [ key, value ] of Object.entries(config.downloadParams)) {
        url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHODRUG_DOWNLOAD_TIMEOUT_MS);

    let response: Response;
    try {
        response = await fetch(url, {
            headers: {
                [WHODRUG_CLIENT_KEY_HEADER]: config.clientKey,
                [WHODRUG_LICENSE_KEY_HEADER]: config.licenseKey
            },
            signal: controller.signal
        });
    } catch (error) {
        esaviLog(`[ERROR]: ESAVI-WHODPROD-007 - Network failure downloading the WHODrug standard: ${ error }`, 'error');
        throw new AppError(getMessage('whodrugProduct.downloadFailed', lang), 502, 'WHODPROD_007_DOWNLOAD_FAILED', error);
    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) {
        esaviLog(`[ERROR]: ESAVI-WHODPROD-007 - WHODrug download endpoint answered ${ response.status }`, 'error');
        throw new AppError(getMessage('whodrugProduct.downloadFailed', lang), 502, 'WHODPROD_007_DOWNLOAD_FAILED');
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
        esaviLog('[ERROR]: ESAVI-WHODPROD-007 - WHODrug download endpoint returned a non-array body', 'error');
        throw new AppError(getMessage('whodrugProduct.downloadFailed', lang), 502, 'WHODPROD_007_DOWNLOAD_FAILED');
    }

    return payload as WhodrugApiDrug[];
}

// §3.5 point 6 — a row is rejected once, by the first rule it fails: emptiness first, then width,
// then duplication within the same download (checked by the caller, which is the only one holding
// the running set of seen hashes)
const validateFlatRow = (row: WhodrugProductFlatRow): RejectedWhodrugProduct | undefined => {
    if (!row.drugCode) {
        return { drugCode: null, reason: 'EMPTY_DRUG_CODE' };
    }
    if (!row.drugName) {
        return { drugCode: row.drugCode, reason: 'EMPTY_DRUG_NAME' };
    }
    if (!row.optionName) {
        return { drugCode: row.drugCode, reason: 'EMPTY_OPTION_NAME' };
    }
    for (const [ column, maxLength ] of Object.entries(COLUMN_MAX_LENGTHS)) {
        const value = row[column as keyof WhodrugProductFlatRow];
        if (typeof value === 'string' && value.length > maxLength) {
            return { drugCode: row.drugCode, reason: 'VALUE_TOO_LONG', column };
        }
    }
    return undefined;
}

// The seven data fields §3.5's differential table sends into buildDifferentialUpdate, always by
// presence: the 007 receives the complete standard, never a partial body, so a value the API
// stopped sending is a value that was erased and must reach the diff as null — never as undefined
const buildRowCandidates = (row: WhodrugProductFlatRow): Record<string, unknown> => ({
    drugName: row.drugName,
    drugAtcs: row.drugAtcs ?? null,
    medicinalProductId: row.medicinalProductId ?? null,
    atcs: row.atcs ?? null,
    ingredient: row.ingredient ?? null,
    ingredientTranslations: row.ingredientTranslations ?? null,
    languageCode: row.languageCode ?? null,
    maHolders: row.maHolders ?? null,
    form: row.form ?? null,
    strength: row.strength ?? null,
    isGeneric: row.isGeneric,
    isPreferred: row.isPreferred,
    optionName: row.optionName,
    optionNameSearch: row.optionNameSearch
});

interface SyncCounters {
    inserted: number;
    updated: number;
    unchanged: number;
    deactivated: number;
}

// §3.5 point 7 — one batch, one transaction (undefined on a dry run, where nothing is written).
// Existing rows are read whole and unfiltered, which is buildDifferentialUpdate's precondition
const processSyncBatch = async (
    batch: WhodrugProductFlatRow[],
    userId: string,
    dryRun: boolean,
    insertMetadata: Record<string, unknown>,
    counters: SyncCounters,
    transaction?: Transaction
): Promise<void> => {
    const existingRows = await WhodrugProduct.findAll({
        where: { rowHash: { [Op.in]: batch.map(row => row.rowHash) } },
        transaction
    });
    const existingByRowHash = new Map(existingRows.map(row => [ row.rowHash, row ]));
    const rowsToInsert: CreationAttributes<WhodrugProduct>[] = [];

    for (const row of batch) {
        const storedRow = existingByRowHash.get(row.rowHash);

        if (!storedRow) {
            rowsToInsert.push({
                rowHash: row.rowHash,
                drugCode: row.drugCode,
                ...buildRowCandidates(row),
                isActive: true,
                deletedAt: null,
                // Sealed here and never touched by the differential branch: see §3.5, downloadedAt
                // would otherwise differ on every sync and rewrite every row forever
                metadata: insertMetadata,
                appDetails: [{
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-WHODPROD-007',
                    detail: 'WhodrugProduct created by sync service'
                }]
            } as CreationAttributes<WhodrugProduct>);
            continue;
        }

        const stored = storedRow.get({ plain: true }) as Record<string, unknown>;
        const objectToUpdate = buildDifferentialUpdate(stored, buildRowCandidates(row));
        const isReactivation = storedRow.isActive === false;

        if (Object.keys(objectToUpdate).length === 0 && !isReactivation) {
            counters.unchanged++;
            continue;
        }

        counters.updated++;
        if (!dryRun) {
            const currentAppDetails = Array.isArray(storedRow.appDetails) ? storedRow.appDetails : [];
            const detail = isReactivation
                ? 'WhodrugProduct reactivated by sync service'
                : 'WhodrugProduct updated by sync service';
            const newEntry: AppDetails = {
                createdAt: new Date(),
                user: userId,
                method: 'ESAVI-WHODPROD-007',
                detail
            };
            await storedRow.update({
                ...objectToUpdate,
                ...(isReactivation ? { isActive: true, deletedAt: null } : {}),
                updatedAt: new Date(),
                appDetails: [ ...currentAppDetails, newEntry ]
            }, { transaction });
        }
    }

    if (rowsToInsert.length > 0) {
        counters.inserted += rowsToInsert.length;
        if (!dryRun) {
            await WhodrugProduct.bulkCreate(rowsToInsert, { transaction });
        }
    }
}

// §3.5 point 8 — a row still active whose rowHash this download did not bring is a product that
// left the standard. Batched the same way the writes are, each batch in its own transaction
const deactivateMissingRows = async (
    encounteredRowHashes: Set<string>,
    userId: string,
    dryRun: boolean
): Promise<number> => {
    const rowsToDeactivate = await WhodrugProduct.findAll({
        where: {
            isActive: true,
            rowHash: { [Op.notIn]: Array.from(encounteredRowHashes) }
        }
    });

    if (dryRun || rowsToDeactivate.length === 0) {
        return rowsToDeactivate.length;
    }

    for (let index = 0; index < rowsToDeactivate.length; index += WHODRUG_BATCH_SIZE) {
        const batch = rowsToDeactivate.slice(index, index + WHODRUG_BATCH_SIZE);
        const transaction = await sequelize.transaction();
        try {
            for (const row of batch) {
                const currentAppDetails = Array.isArray(row.appDetails) ? row.appDetails : [];
                const newEntry: AppDetails = {
                    createdAt: new Date(),
                    user: userId,
                    method: 'ESAVI-WHODPROD-007',
                    detail: 'WhodrugProduct deactivated by sync service: no longer in the standard'
                };
                await row.update({
                    isActive: false,
                    deletedAt: new Date(),
                    updatedAt: new Date(),
                    appDetails: [ ...currentAppDetails, newEntry ]
                }, { transaction });
            }
            await transaction.commit();
        } catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    return rowsToDeactivate.length;
}

// ESAVI-WHODPROD-007 - Sync Whodrug Products Service
const syncWhodrugProductsService = async (
    data: SyncWhodrugProductsInput,
    authUser: AuthUser | undefined,
    lang: string
): Promise<WhodrugProductSyncReport> => {
    // 1. The general switch. A deliberate shutdown, told apart from a breakdown by a 503 instead
    // of an empty report, and checked before anything goes out to the network
    const isEnabled = await getAppConfigBoolean(WHODRUG_ENABLED_CODE, WHODRUG_SCOPE, lang);
    if (!isEnabled) {
        esaviLog('[ERROR]: ESAVI-WHODPROD-007 - WHODrug standard sync is disabled in this deployment', 'error');
        throw new AppError(getMessage('whodrugProduct.syncDisabled', lang), 503, 'WHODPROD_007_DISABLED');
    }

    if (isSyncRunning) {
        esaviLog('[ERROR]: ESAVI-WHODPROD-007 - A WHODrug sync is already running', 'error');
        throw new AppError(getMessage('whodrugProduct.syncAlreadyRunning', lang), 409, 'WHODPROD_007_ALREADY_RUNNING');
    }
    isSyncRunning = true;

    try {
        const userId = authUser?.userId || 'undefined';
        const dryRun = data.dryRun ?? false;

        // 2. Resolved before any fetch: a deployment with the switch on and no credentials fails
        // here and never spends a call on the licensed API
        const config = await resolveWhodrugDownloadConfig(lang);

        // 3
        const drugs = await downloadWhodrugStandard(config, lang);
        const downloadedAt = new Date();
        const insertMetadata: Record<string, unknown> = {
            source: 'UMC_REGIONAL_DRUGS',
            dictionaryVersion: data.dictionaryVersion ?? null,
            downloadedAt,
            params: config.downloadParams
        };

        // 4 and 5 — the pure walk and its derived fields, with no ATC exclusion and no country
        // filter: the mirror is integral
        const flattenedRows = flattenWhodrugProducts(drugs);

        // 6. Rejections, evaluated in this download's own scope: a row rejected here never enters
        // a batch and its rowHash — when it has one — is not counted as encountered
        const encounteredRowHashes = new Set<string>();
        const acceptedRows: WhodrugProductFlatRow[] = [];
        const rejected: RejectedWhodrugProduct[] = [];
        let invalid = 0;
        let duplicated = 0;

        for (const row of flattenedRows) {
            const rejection = validateFlatRow(row);
            if (rejection) {
                rejected.push(rejection);
                invalid++;
                continue;
            }
            if (encounteredRowHashes.has(row.rowHash)) {
                rejected.push({ drugCode: row.drugCode, reason: 'DUPLICATE_IN_DOWNLOAD' });
                duplicated++;
                continue;
            }
            encounteredRowHashes.add(row.rowHash);
            acceptedRows.push(row);
        }

        // 7. One batch at a time, one transaction per batch — undefined on a dry run, where
        // nothing is written and reimporting stays idempotent
        const counters: SyncCounters = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };

        for (let index = 0; index < acceptedRows.length; index += WHODRUG_BATCH_SIZE) {
            const batch = acceptedRows.slice(index, index + WHODRUG_BATCH_SIZE);
            if (dryRun) {
                await processSyncBatch(batch, userId, dryRun, insertMetadata, counters);
                continue;
            }
            const transaction = await sequelize.transaction();
            try {
                await processSyncBatch(batch, userId, dryRun, insertMetadata, counters, transaction);
                await transaction.commit();
            } catch (error) {
                await transaction.rollback();
                esaviLog(`[ERROR]: ESAVI-WHODPROD-007 - Batch starting at index ${ index } failed and was rolled back`, 'error');
                throw new AppError(getMessage('whodrugProduct.syncFailed', lang), 500, 'WHODPROD_007_SYNC_FAILED', error);
            }
        }

        // 8. What is active and was not brought by this download
        counters.deactivated = await deactivateMissingRows(encounteredRowHashes, userId, dryRun);

        esaviLog(
            `[INFO]: ESAVI-WHODPROD-007 - WHODrug sync${ dryRun ? ' (dry run)' : '' }: ` +
            `${ drugs.length } downloaded, ${ flattenedRows.length } flattened, ${ counters.inserted } inserted, ` +
            `${ counters.updated } updated, ${ counters.unchanged } unchanged, ${ counters.deactivated } deactivated`,
            'info'
        );

        return {
            downloaded: drugs.length,
            flattened: flattenedRows.length,
            inserted: counters.inserted,
            updated: counters.updated,
            unchanged: counters.unchanged,
            deactivated: counters.deactivated,
            invalid,
            duplicated,
            dryRun,
            errors: rejected.slice(0, MAX_REPORTED_SYNC_ERRORS)
        };
    } finally {
        isSyncRunning = false;
    }
}

// ---------------------------------------------------------------------------------------------
// SPEC F56 §3.5 — ESAVI-WHODPROD-006: search concomitant medication
// ---------------------------------------------------------------------------------------------

// §3.5 point 1 — the two reads of scope WHODRUG that turn into the query's policy. The client
// cannot ask for vaccines or switch country: if it could, the exclusion would stop being a rule
// of the system. Resolved on every search and never cached, same as the 007's own configuration
const resolveWhodrugSearchPolicy = async (lang: string): Promise<WhodrugSearchPolicy> => {
    try {
        const [ countryIso3, excludedAtcPrefixes ] = await Promise.all([
            getAppConfigString(WHODRUG_SEARCH_COUNTRY_CODE, WHODRUG_SCOPE, lang),
            getAppConfigJson<string[]>(WHODRUG_SEARCH_EXCLUDED_ATC_CODE, WHODRUG_SCOPE, lang)
        ]);
        return { countryIso3, excludedAtcPrefixes };
    } catch (error) {
        if (error instanceof AppError && error.code === MISSING_CONFIG_CODE) {
            esaviLog(`[ERROR]: ESAVI-WHODPROD-006 - WHODrug search is not configured: ${ error.message }`, 'error');
            throw new AppError(getMessage('whodrugProduct.notConfigured', lang), 503, 'WHODPROD_006_NOT_CONFIGURED', error);
        }
        throw error;
    }
}

interface WhodrugSearchRow {
    drugCode: string;
    optionName: string;
}

// ESAVI-WHODPROD-006 - Search Whodrug Products Service (concomitant medication)
//
// DISTINCT ON ("drugCode") collapses every presentation of a medicine down to one row, letting
// the preferred one win via ORDER BY "isPreferred" DESC — Postgres requires the ORDER BY to start
// with the DISTINCT ON column, so the result set comes back ordered by drugCode and not by
// relevance. There is no deduplication by name: two different medicines that share a commercial
// name must both appear
const searchWhodrugProductsService = async (
    term: string,
    limit: number,
    lang: string
): Promise<{ term: string; count: number; rows: WhodrugSearchOption[] }> => {
    const policy = await resolveWhodrugSearchPolicy(lang);
    // The same normalization the 007 gave optionNameSearch at import time: lowercase, no
    // diacritics — so 'cetamol' and 'cétamol' hit the same rows
    const pattern = `%${ escapeLike(toWhodrugSearchForm(term)) }%`;

    const replacements: Record<string, unknown> = { pattern, countryIso3: policy.countryIso3, limit };
    // COALESCE against '': a bare NOT LIKE against a NULL drugAtcs evaluates to NULL under SQL's
    // three-valued logic, which WHERE treats as false — silently hiding a medicine that carries no
    // ATC at all, never a vaccine, from every search. Not in SPEC F56's literal query; fixed here
    // because a product with no ATC disappearing from the search it exists for is a correctness
    // bug, not a policy choice
    const excludedAtcConditions = policy.excludedAtcPrefixes.map((prefix, index) => {
        replacements[`excludedAtc${ index }`] = `%;${ prefix }%`;
        return `COALESCE("drugAtcs", '') NOT LIKE :excludedAtc${ index }`;
    });
    const excludedAtcClause = excludedAtcConditions.length > 0 ? `AND ${ excludedAtcConditions.join(' AND ') }` : '';

    let rows: WhodrugSearchRow[];
    try {
        rows = await sequelize.query<WhodrugSearchRow>(
            `SELECT DISTINCT ON ("drugCode") "drugCode", "optionName"
             FROM "whodrugProduct"
             WHERE "isActive" = true AND "deletedAt" IS NULL
               AND "optionNameSearch" LIKE :pattern
               ${ excludedAtcClause }
               AND ( "iso3Code" = :countryIso3 OR ( "iso3Code" IS NULL AND "isGeneric" = true ) )
             ORDER BY "drugCode", "isPreferred" DESC, "optionName"
             LIMIT :limit`,
            { replacements, type: QueryTypes.SELECT }
        );
    } catch (error) {
        esaviLog(`[ERROR]: ESAVI-WHODPROD-006 - Search query failed: ${ error }`, 'error');
        throw new AppError(getMessage('whodrugProduct.searchFailed', lang), 500, 'WHODPROD_006_FETCH_FAILED', error);
    }

    return {
        term,
        count: rows.length,
        rows: rows.map(row => ({ code: row.drugCode, name: row.optionName }))
    };
}

export {
    getAllWhodrugProductsService,
    searchWhodrugProductsService,
    syncWhodrugProductsService
};
