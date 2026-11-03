import { QueryTypes } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType } from '../models';
import { AppError, canViewAuditAuthors, esaviLog, getAppConfigNumber, getMessage, listEpiWeeks, resolveDashboardPeriod } from '../helpers';
import {
    AuthUser,
    CaseWorkflowStage,
    DashboardActivityAction,
    DashboardActivityEvent,
    DashboardMyCase,
    DashboardRecentActivity,
    DashboardBatchAlert,
    DashboardBatchAlertReason,
    DashboardBatchAlerts,
    DashboardASubcategory,
    DashboardCausalityCategory,
    DashboardComparable,
    DashboardDistributions,
    DashboardEpiCurve,
    DashboardEpiWeek,
    DashboardGeoRow,
    DashboardIndicators,
    DashboardPendingInvestigation,
    DashboardPendingWork,
    DashboardPeriod,
    DashboardPeriodQuery,
    DashboardSeverityCriterion,
    DashboardStalledCase,
    DashboardStatusCount,
    DashboardSystemActivity,
    DashboardVaccineRow
} from '../types';
import { CASE_WORKFLOW_STAGE_FIELD, CASE_WORKFLOW_STAGES, CASE_WORKFLOW_STATUS, CASE_WORKFLOW_STATUS_CATALOG_CODE } from '../constants/caseWorkflow.constants';
import {
    DASHBOARD_ACTIVITY_ACTION_MAP,
    DASHBOARD_ACTIVITY_EXCLUDED_METHODS,
    DASHBOARD_ACTIVITY_LIMIT,
    DASHBOARD_ACTIVITY_WINDOW_DAYS,
    DASHBOARD_AGE_BANDS,
    DASHBOARD_MY_CASES_LIMIT,
    DASHBOARD_BATCH_ALERT_LIMIT,
    DASHBOARD_BATCH_MIN_CASES_CODE,
    DASHBOARD_BATCH_MIN_CASES_DEFAULT,
    DASHBOARD_BATCH_MIN_SERIOUS_CODE,
    DASHBOARD_BATCH_MIN_SERIOUS_DEFAULT,
    DASHBOARD_CONFIG_SCOPE,
    DASHBOARD_SEX_CODES,
    DASHBOARD_STALE_DAYS_CODE,
    DASHBOARD_TOP_LIMIT,
    DASHBOARD_VACCINE_TOP_LIMIT,
    NOTIFICATION_CONFIG_SCOPE,
    NOTIFICATION_DEADLINE_DAYS_CODE
} from '../constants/dashboard.constants';
import { FINAL_CLASSIFICATION_IMPORTANCE_CATALOG_CODE, FINAL_CLASSIFICATION_TOP_IMPORTANCE_VALUE } from '../constants/finalClassification.constants';
import { BATCH_NUMBER_NORMALIZED_SQL, VACCINE_KEY_SQL } from '../constants/notificationVaccine.constants';
import { SESSION_REVOKE_REASONS } from '../constants/session.constants';
import { MAX_GEO_SUBTREE_DEPTH, resolveGeoSubtreeIds, resolveUserGeoRootIds, resolveUserGeoScopeIds } from './common/geoScope.service';
import { resolveAppDetailsAuthorsService } from './common/appDetailsAuthors.service';

const MISSING_CONFIG_CODE = 'APPCONFIG_VALUE_MISSING';

const isTopImportanceSql = (column: string): string => `EXISTS (
            SELECT 1 FROM "catalogItem" imp
            JOIN "catalogType" impType ON impType."catalogTypeId" = imp."catalogTypeId"
            WHERE imp."catalogItemId" = fc."${ column }"
                AND impType."code" = '${ FINAL_CLASSIFICATION_IMPORTANCE_CATALOG_CODE }'
                AND imp."value" = '${ FINAL_CLASSIFICATION_TOP_IMPORTANCE_VALUE }'
        )`;

const CAUSALITY_CATEGORY_SQL = `CASE
        WHEN fc."dIsUnclassifiable" IS TRUE THEN 'D'
        WHEN ${ isTopImportanceSql('importanceAItemId') } THEN 'A'
        WHEN ${ isTopImportanceSql('importanceBItemId') } THEN 'B'
        WHEN ${ isTopImportanceSql('importanceCItemId') } THEN 'C'
        WHEN fc."aIsRelatedToVaccineProduct" IS TRUE
            OR fc."aIsRelatedToQualityDeviation" IS TRUE
            OR fc."aIsRelatedToProgrammaticError" IS TRUE
            OR fc."aIsRelatedToStress" IS TRUE THEN 'A'
        WHEN fc."bIsConsistentTemporalRelation" IS TRUE
            OR fc."bHasDeterminantFactor" IS TRUE THEN 'B'
        WHEN fc."cHasCoincidentCause" IS TRUE THEN 'C'
        ELSE 'UNCLASSIFIED'
    END`;

interface StatusItem {
    catalogItemId: string;
    code: string;
    name: string;
    sortOrder: number;
}

interface FunnelRow {
    catalogItemId: string;
    count: number;
}

interface StalledRow {
    caseId: string;
    caseCode: string;
    statusCode: string;
    openStage: CaseWorkflowStage | null;
    referenceAt: Date;
    daysStalled: number;
    total: number;
}

interface PendingInvestigationRow {
    caseId: string;
    caseCode: string;
    statusCode: string;
    requestedAt: Date;
    daysWaiting: number;
    total: number;
}

interface TotalRow {
    total: number;
}

const OPEN_STAGE_VALUES = CASE_WORKFLOW_STAGES
    .map(( stage ) => {
        const field = CASE_WORKFLOW_STAGE_FIELD[stage];
        return `('${ stage }', u."${ field }StartedAt", u."${ field }EndedAt")`;
    })
    .join(',\n                ');

const buildUniverseSql = (restricted: boolean): string => `
    SELECT c."caseId", c."caseCode", c."patientId", c."healthFacilityId", c."reportDate", c."eventDate", s."code" AS "statusCode", w."statusItemId", w."openedAt", w."closedAt",
        w."classificationStartedAt", w."classificationEndedAt",
        w."notificationStartedAt", w."notificationEndedAt",
        w."investigationStartedAt", w."investigationEndedAt",
        w."finalClassificationStartedAt", w."finalClassificationEndedAt",
        w."lastReopenedAt", w."reopenCount"
    FROM "esaviCase" c
    JOIN "caseWorkflow" w ON w."caseId" = c."caseId" AND w."isActive" = true
    JOIN "catalogItem" s ON s."catalogItemId" = w."statusItemId"
    ${ restricted ? 'JOIN "healthFacility" h ON h."healthFacilityId" = c."healthFacilityId"' : '' }
    WHERE c."isActive" = true
      AND c."deletedAt" IS NULL
      ${ restricted ? 'AND h."geoLocationId" IN (:scopeIds)' : '' }`;

const daysSinceSql = (column: string): string => `FLOOR(EXTRACT(EPOCH FROM now() - ${ column }) / 86400)::int`;

const emptyPendingWork = (staleDays: number, funnel: DashboardStatusCount[], scope: DashboardPendingWork['scope']): DashboardPendingWork => ({
    generatedAt: new Date().toISOString(),
    scope,
    funnel,
    openCases: 0,
    stalled: { staleDays, total: 0, items: [] },
    pendingInvestigations: { total: 0, items: [] },
    reopened: { total: 0 }
});

const loadStatusItems = async (): Promise<StatusItem[]> => {
    const items = await CatalogItem.findAll({
        where: { isActive: true },
        attributes: ['catalogItemId', 'code', 'name', 'sortOrder'],
        include: [{
            model: CatalogType,
            as: 'catalogType',
            where: { code: CASE_WORKFLOW_STATUS_CATALOG_CODE },
            attributes: []
        }],
        order: [['sortOrder', 'ASC']]
    });
    return items.map(( item ) => ({
        catalogItemId: item.getDataValue('catalogItemId'),
        code: item.getDataValue('code'),
        name: item.getDataValue('name'),
        sortOrder: Number(item.getDataValue('sortOrder') ?? 0)
    }));
}

const readStaleDays = async (lang: string): Promise<number> => {
    try {
        return await getAppConfigNumber(DASHBOARD_STALE_DAYS_CODE, DASHBOARD_CONFIG_SCOPE, lang);
    } catch (error) {
        if( error instanceof AppError && error.code === MISSING_CONFIG_CODE ) {
            esaviLog('ESAVI-DASH-006 - ESAVI_DASHBOARD_STALE_DAYS missing or invalid, stalled block disabled', 'warn');
            return 0;
        }
        throw error;
    }
}

const queryFunnel = async (universeSql: string, replacements: Record<string, unknown>, statusItemIds: string[]): Promise<FunnelRow[]> =>
    sequelize.query<FunnelRow>(
        `SELECT ci."catalogItemId", COUNT(u."caseId")::int AS "count"
        FROM "catalogItem" ci
        LEFT JOIN (${ universeSql }) u ON u."statusItemId" = ci."catalogItemId"
        WHERE ci."catalogItemId" IN (:statusItemIds)
        GROUP BY ci."catalogItemId"`,
        { replacements: { ...replacements, statusItemIds }, type: QueryTypes.SELECT }
    );

const queryStalled = async (universeSql: string, replacements: Record<string, unknown>, staleDays: number): Promise<StalledRow[]> =>
    sequelize.query<StalledRow>(
        `WITH u AS (${ universeSql }),
        measured AS (
            SELECT u."caseId", u."caseCode", u."statusCode", os."stage" AS "openStage",
                GREATEST(COALESCE(os."startedAt", u."openedAt"), u."lastReopenedAt") AS "referenceAt"
            FROM u
            LEFT JOIN LATERAL (
                SELECT v."stage", v."startedAt"
                FROM (VALUES
                ${ OPEN_STAGE_VALUES }
                ) AS v("stage", "startedAt", "endedAt")
                WHERE v."startedAt" IS NOT NULL AND v."endedAt" IS NULL
                ORDER BY v."startedAt" DESC
                LIMIT 1
            ) os ON true
            WHERE u."statusCode" <> :closedCode
        )
        SELECT m."caseId", m."caseCode", m."statusCode", m."openStage", m."referenceAt",
            ${ daysSinceSql('m."referenceAt"') } AS "daysStalled",
            COUNT(*) OVER()::int AS "total"
        FROM measured m
        WHERE ${ daysSinceSql('m."referenceAt"') } >= :staleDays
        ORDER BY m."referenceAt" ASC, m."caseCode" ASC
        LIMIT :topLimit`,
        { replacements: { ...replacements, staleDays, topLimit: DASHBOARD_TOP_LIMIT }, type: QueryTypes.SELECT }
    );

const queryPendingInvestigations = async (universeSql: string, replacements: Record<string, unknown>): Promise<PendingInvestigationRow[]> =>
    sequelize.query<PendingInvestigationRow>(
        `WITH u AS (${ universeSql })
        SELECT u."caseId", u."caseCode", u."statusCode", u."notificationEndedAt" AS "requestedAt",
            ${ daysSinceSql('u."notificationEndedAt"') } AS "daysWaiting",
            COUNT(*) OVER()::int AS "total"
        FROM u
        JOIN "notification" n ON n."caseId" = u."caseId" AND n."isActive" = true AND n."requestInvestigation" = true
        WHERE u."statusCode" <> :closedCode
          AND u."notificationEndedAt" IS NOT NULL
          AND u."investigationStartedAt" IS NULL
        ORDER BY u."notificationEndedAt" ASC, u."caseCode" ASC
        LIMIT :topLimit`,
        { replacements: { ...replacements, topLimit: DASHBOARD_TOP_LIMIT }, type: QueryTypes.SELECT }
    );

const queryReopened = async (universeSql: string, replacements: Record<string, unknown>): Promise<TotalRow[]> =>
    sequelize.query<TotalRow>(
        `WITH u AS (${ universeSql })
        SELECT COUNT(*)::int AS "total"
        FROM u
        WHERE u."statusCode" <> :closedCode
          AND u."reopenCount" > 0`,
        { replacements, type: QueryTypes.SELECT }
    );

// Get Dashboard Pending Work Service
// Code: ESAVI-DASH-006
const getPendingWorkService = async (authUser: AuthUser | undefined, lang: string): Promise<DashboardPendingWork> => {
    try {
        const scopeIds = await resolveUserGeoScopeIds(authUser);
        const scope = { restricted: scopeIds !== null, hasAssignments: scopeIds === null || scopeIds.length > 0 };

        const staleDays = await readStaleDays(lang);

        const statusItems = await loadStatusItems();
        if( statusItems.length === 0 ) {
            throw new AppError(getMessage('dashboard.statusCatalogMissing', lang), 500, 'DASH_006_STATUS_CATALOG_MISSING');
        }

        const zeroFunnel = statusItems.map(( item ) => ({ statusCode: item.code, statusName: item.name, sortOrder: item.sortOrder, count: 0 }));
        if( scopeIds !== null && scopeIds.length === 0 ) {
            return emptyPendingWork(staleDays, zeroFunnel, scope);
        }

        const universeSql = buildUniverseSql(scopeIds !== null);
        const replacements: Record<string, unknown> = { closedCode: CASE_WORKFLOW_STATUS.CLOSED };
        if( scopeIds !== null ) replacements.scopeIds = scopeIds;

        const [funnelRows, stalledRows, pendingRows, reopenedRows] = await Promise.all([
            queryFunnel(universeSql, replacements, statusItems.map(( item ) => item.catalogItemId )),
            staleDays >= 1 ? queryStalled(universeSql, replacements, staleDays) : Promise.resolve([] as StalledRow[]),
            queryPendingInvestigations(universeSql, replacements),
            queryReopened(universeSql, replacements)
        ]);

        const countByItem = new Map(funnelRows.map(( row ) => [row.catalogItemId, row.count] ));
        const funnel = statusItems.map(( item ) => ({
            statusCode: item.code,
            statusName: item.name,
            sortOrder: item.sortOrder,
            count: countByItem.get(item.catalogItemId) ?? 0
        }));
        const openCases = funnel
            .filter(( status ) => status.statusCode !== CASE_WORKFLOW_STATUS.CLOSED )
            .reduce(( sum, status ) => sum + status.count, 0 );

        const stalledItems: DashboardStalledCase[] = stalledRows.map(( row ) => ({
            caseId: row.caseId,
            caseCode: row.caseCode,
            statusCode: row.statusCode,
            openStage: row.openStage,
            referenceAt: new Date(row.referenceAt).toISOString(),
            daysStalled: row.daysStalled
        }));
        const pendingItems: DashboardPendingInvestigation[] = pendingRows.map(( row ) => ({
            caseId: row.caseId,
            caseCode: row.caseCode,
            statusCode: row.statusCode,
            requestedAt: new Date(row.requestedAt).toISOString(),
            daysWaiting: row.daysWaiting
        }));

        return {
            generatedAt: new Date().toISOString(),
            scope,
            funnel,
            openCases,
            stalled: { staleDays, total: stalledRows[0]?.total ?? 0, items: stalledItems },
            pendingInvestigations: { total: pendingRows[0]?.total ?? 0, items: pendingItems },
            reopened: { total: reopenedRows[0]?.total ?? 0 }
        };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.pendingWorkFailed', lang), 500, 'DASH_006_FETCH_FAILED', error);
    }
}

const COMPARABLE_CONDITIONS = {
    total: 'TRUE',
    severe: `p."notificationType" = 'SEVERE'`,
    nonSevere: `p."notificationType" = 'NON_SEVERE'`,
    noNotification: 'p."notificationType" IS NULL',
    classified: 'p."classified"',
    serious: 'p."classified" AND p."isSeriousEvent" IS TRUE',
    unclassified: 'NOT p."classified"',
    deaths: 'p."causedDeath" IS TRUE OR p."deathDate" IS NOT NULL OR p."isDeath" IS TRUE'
} as const;

type ComparableKey = keyof typeof COMPARABLE_CONDITIONS;

const SEVERITY_CRITERIA_COLUMNS: Record<DashboardSeverityCriterion, string> = {
    death: 'causedDeath',
    disability: 'causedDisability',
    congenitalAnomaly: 'causedCongenitalAnomaly',
    fetalDeath: 'causedFetalDeath',
    lifeThreatening: 'causedLifeThreatening',
    hospitalization: 'causedHospitalization',
    abortion: 'causedAbortion',
    otherCondition: 'causedOtherCondition'
};

const A_SUBCATEGORY_COLUMNS: Record<DashboardASubcategory, string> = {
    vaccineProduct: 'aIsRelatedToVaccineProduct',
    qualityDeviation: 'aIsRelatedToQualityDeviation',
    programmaticError: 'aIsRelatedToProgrammaticError',
    stress: 'aIsRelatedToStress'
};

const CAUSALITY_CATEGORIES: DashboardCausalityCategory[] = ['A', 'B', 'C', 'D', 'UNCLASSIFIED'];

type CountRow = Record<string, number>;

type MedianRow = Record<string, number | string | null>;

const medianDaysSql = (expression: string): string =>
    `ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY ${ expression }))::numeric, 1)`;

const intervalDaysSql = (endColumn: string, startColumn: string): string =>
    `EXTRACT(EPOCH FROM ${ endColumn } - ${ startColumn }) / 86400`;

const toNullableNumber = (value: number | string | null | undefined): number | null =>
    value === null || value === undefined ? null : Number(value);

const mapRecord = <K extends string, V, R>(source: Record<K, V>, map: (value: V, key: K) => R): Record<K, R> =>
    Object.fromEntries(Object.entries(source).map(( [key, value] ) => [key, map(value as V, key as K)] )) as Record<K, R>;

const queryVolumeSeverityDeaths = async (universeSql: string, replacements: Record<string, unknown>): Promise<CountRow> => {
    const comparableColumns = Object.entries(COMPARABLE_CONDITIONS).map(( [key, condition] ) =>
        `COUNT(*) FILTER (WHERE p."isCurrent" AND (${ condition }))::int AS "${ key }Current",
            COUNT(*) FILTER (WHERE p."isPrevious" AND (${ condition }))::int AS "${ key }Previous"`);
    const criteriaColumns = Object.entries(SEVERITY_CRITERIA_COLUMNS).map(( [key, column] ) =>
        `COUNT(*) FILTER (WHERE p."isCurrent" AND p."classified" AND p."${ column }" IS TRUE)::int AS "criteria_${ key }"`);

    const [row] = await sequelize.query<CountRow>(
        `WITH u AS (${ universeSql }),
        p AS (
            SELECT u."reportDate" BETWEEN :from AND :to AS "isCurrent",
                u."reportDate" BETWEEN :previousFrom AND :previousTo AS "isPrevious",
                n."notificationType", n."deathDate", n."autopsyRequested",
                cl."caseId" IS NOT NULL AS "classified", cl."isSeriousEvent",
                ${ Object.values(SEVERITY_CRITERIA_COLUMNS).map(( column ) => `cl."${ column }"` ).join(', ') },
                ia."isDeath", ia."isAutopsyPerformed"
            FROM u
            LEFT JOIN "notification" n ON n."caseId" = u."caseId" AND n."isActive" = true
            LEFT JOIN "classification" cl ON cl."caseId" = u."caseId" AND cl."isActive" = true
            LEFT JOIN "investigation" inv ON inv."caseId" = u."caseId" AND inv."isActive" = true
            LEFT JOIN "investigationAutopsy" ia ON ia."investigationId" = inv."investigationId" AND ia."deletedAt" IS NULL
            WHERE u."reportDate" BETWEEN :previousFrom AND :to
        )
        SELECT ${ comparableColumns.join(',\n            ') },
            ${ criteriaColumns.join(',\n            ') },
            COUNT(*) FILTER (WHERE p."isCurrent" AND p."autopsyRequested" IS TRUE)::int AS "autopsyRequested",
            COUNT(*) FILTER (WHERE p."isCurrent" AND p."isAutopsyPerformed" IS TRUE)::int AS "autopsyPerformed"
        FROM p`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const queryTimeliness = async (universeSql: string, replacements: Record<string, unknown>): Promise<MedianRow> => {
    const [row] = await sequelize.query<MedianRow>(
        `WITH u AS (${ universeSql })
        SELECT COUNT(*) FILTER (WHERE u."eventDate" IS NOT NULL)::int AS "withEventDate",
            COUNT(*) FILTER (WHERE u."eventDate" IS NULL)::int AS "withoutEventDate",
            ${ medianDaysSql('(u."reportDate" - u."eventDate")') } AS "medianDays",
            COUNT(*) FILTER (WHERE u."eventDate" IS NOT NULL AND (u."reportDate" - u."eventDate") <= :deadlineDays)::int AS "onTime"
        FROM u
        WHERE u."reportDate" BETWEEN :from AND :to`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const queryClosure = async (universeSql: string, replacements: Record<string, unknown>): Promise<MedianRow> => {
    const stageColumns = CASE_WORKFLOW_STAGES.map(( stage ) => {
        const field = CASE_WORKFLOW_STAGE_FIELD[stage];
        return `${ medianDaysSql(intervalDaysSql(`u."${ field }EndedAt"`, `u."${ field }StartedAt"`)) } AS "${ stage }"`;
    });

    const [row] = await sequelize.query<MedianRow>(
        `WITH u AS (${ universeSql })
        SELECT COUNT(*)::int AS "closedCases",
            ${ medianDaysSql(intervalDaysSql('u."closedAt"', 'u."openedAt"')) } AS "medianDaysToClose",
            ${ stageColumns.join(',\n            ') }
        FROM u
        WHERE u."statusCode" = :closedCode
          AND u."closedAt"::date BETWEEN :from AND :to`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const queryCausality = async (universeSql: string, replacements: Record<string, unknown>): Promise<CountRow> => {
    const categoryColumns = CAUSALITY_CATEGORIES.map(( category ) =>
        `COUNT(*) FILTER (WHERE p."hasFinalClassification" AND p."category" = '${ category }')::int AS "category_${ category }"`);
    const subcategoryColumns = Object.entries(A_SUBCATEGORY_COLUMNS).map(( [key, column] ) =>
        `COUNT(*) FILTER (WHERE p."hasFinalClassification" AND p."category" = 'A' AND p."${ column }" IS TRUE)::int AS "a_${ key }"`);

    const [row] = await sequelize.query<CountRow>(
        `WITH u AS (${ universeSql }),
        p AS (
            SELECT fc."caseId" IS NOT NULL AS "hasFinalClassification",
                ${ CAUSALITY_CATEGORY_SQL } AS "category",
                ${ Object.values(A_SUBCATEGORY_COLUMNS).map(( column ) => `fc."${ column }"` ).join(', ') }
            FROM u
            LEFT JOIN "finalClassification" fc ON fc."caseId" = u."caseId" AND fc."isActive" = true
            WHERE u."reportDate" BETWEEN :from AND :to
        )
        SELECT COUNT(*) FILTER (WHERE p."hasFinalClassification")::int AS "withFinalClassification",
            COUNT(*) FILTER (WHERE NOT p."hasFinalClassification")::int AS "withoutFinalClassification",
            ${ categoryColumns.join(',\n            ') },
            ${ subcategoryColumns.join(',\n            ') }
        FROM p`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const readNotificationDeadlineDays = async (lang: string): Promise<number | null> => {
    try {
        return await getAppConfigNumber(NOTIFICATION_DEADLINE_DAYS_CODE, NOTIFICATION_CONFIG_SCOPE, lang);
    } catch (error) {
        if( error instanceof AppError && error.code === MISSING_CONFIG_CODE ) {
            esaviLog('ESAVI-DASH-007 - ESAVI_NOTIFICATION_DEADLINE_DAYS missing or invalid, onTime disabled', 'warn');
            return null;
        }
        throw error;
    }
}

const resolveIndicatorsScopeIds = async (userScopeIds: string[] | null, geoLocationId: string | undefined): Promise<string[] | null> => {
    if( !geoLocationId ) return userScopeIds;
    if( userScopeIds !== null && userScopeIds.length === 0 ) return [];
    const subtreeIds = await resolveGeoSubtreeIds([geoLocationId]);
    if( userScopeIds === null ) return subtreeIds;
    const userScope = new Set(userScopeIds);
    return subtreeIds.filter(( id ) => userScope.has(id) );
}

const zeroComparable = (): DashboardComparable => ({ current: 0, previous: 0 });

const comparableFrom = (row: CountRow, key: ComparableKey): DashboardComparable => ({
    current: row[`${ key }Current`] ?? 0,
    previous: row[`${ key }Previous`] ?? 0
});

const emptyIndicators = (
    period: DashboardPeriod,
    previousPeriod: DashboardPeriod,
    scope: DashboardIndicators['scope']
): DashboardIndicators => ({
    period,
    previousPeriod,
    scope,
    volume: {
        total: zeroComparable(),
        byNotificationType: { SEVERE: zeroComparable(), NON_SEVERE: zeroComparable(), none: zeroComparable() }
    },
    severity: {
        classified: zeroComparable(),
        serious: zeroComparable(),
        unclassified: zeroComparable(),
        criteria: mapRecord(SEVERITY_CRITERIA_COLUMNS, () => 0 )
    },
    deaths: { total: zeroComparable(), autopsyRequested: 0, autopsyPerformed: 0 },
    timeliness: { withEventDate: 0, withoutEventDate: 0, medianDays: null, onTime: null, deadlineDays: null },
    closure: {
        closedCases: 0,
        medianDaysToClose: null,
        stageMedianDays: Object.fromEntries(CASE_WORKFLOW_STAGES.map(( stage ) => [stage, null] )) as Record<CaseWorkflowStage, number | null>
    },
    causality: {
        withFinalClassification: 0,
        withoutFinalClassification: 0,
        categories: Object.fromEntries(CAUSALITY_CATEGORIES.map(( category ) => [category, 0] )) as Record<DashboardCausalityCategory, number>,
        aSubcategories: mapRecord(A_SUBCATEGORY_COLUMNS, () => 0 )
    }
});

// Get Dashboard Indicators Service
// Code: ESAVI-DASH-007
const getIndicatorsService = async (query: DashboardPeriodQuery, authUser: AuthUser | undefined, lang: string): Promise<DashboardIndicators> => {
    try {
        const { period, previousPeriod } = resolveDashboardPeriod({ from: query.from, to: query.to });

        const userScopeIds = await resolveUserGeoScopeIds(authUser);
        const scopeIds = await resolveIndicatorsScopeIds(userScopeIds, query.geoLocationId);
        const scope = {
            restricted: scopeIds !== null,
            hasAssignments: userScopeIds === null || userScopeIds.length > 0,
            geoLocationId: query.geoLocationId ?? null
        };

        if( scopeIds !== null && scopeIds.length === 0 ) {
            return emptyIndicators(period, previousPeriod, scope);
        }

        const deadlineDays = await readNotificationDeadlineDays(lang);

        const universeSql = buildUniverseSql(scopeIds !== null);
        const replacements: Record<string, unknown> = {
            from: period.from,
            to: period.to,
            previousFrom: previousPeriod.from,
            previousTo: previousPeriod.to,
            closedCode: CASE_WORKFLOW_STATUS.CLOSED,
            deadlineDays
        };
        if( scopeIds !== null ) replacements.scopeIds = scopeIds;

        const [countRow, timelinessRow, closureRow, causalityRow] = await Promise.all([
            queryVolumeSeverityDeaths(universeSql, replacements),
            queryTimeliness(universeSql, replacements),
            queryClosure(universeSql, replacements),
            queryCausality(universeSql, replacements)
        ]);

        return {
            period,
            previousPeriod,
            scope,
            volume: {
                total: comparableFrom(countRow, 'total'),
                byNotificationType: {
                    SEVERE: comparableFrom(countRow, 'severe'),
                    NON_SEVERE: comparableFrom(countRow, 'nonSevere'),
                    none: comparableFrom(countRow, 'noNotification')
                }
            },
            severity: {
                classified: comparableFrom(countRow, 'classified'),
                serious: comparableFrom(countRow, 'serious'),
                unclassified: comparableFrom(countRow, 'unclassified'),
                criteria: mapRecord(SEVERITY_CRITERIA_COLUMNS, ( _column, key ) => countRow[`criteria_${ key }`] ?? 0 )
            },
            deaths: {
                total: comparableFrom(countRow, 'deaths'),
                autopsyRequested: countRow.autopsyRequested ?? 0,
                autopsyPerformed: countRow.autopsyPerformed ?? 0
            },
            timeliness: {
                withEventDate: Number(timelinessRow.withEventDate ?? 0),
                withoutEventDate: Number(timelinessRow.withoutEventDate ?? 0),
                medianDays: toNullableNumber(timelinessRow.medianDays),
                onTime: deadlineDays === null ? null : Number(timelinessRow.onTime ?? 0),
                deadlineDays
            },
            closure: {
                closedCases: Number(closureRow.closedCases ?? 0),
                medianDaysToClose: toNullableNumber(closureRow.medianDaysToClose),
                stageMedianDays: Object.fromEntries(CASE_WORKFLOW_STAGES.map(( stage ) =>
                    [stage, toNullableNumber(closureRow[stage])] )) as Record<CaseWorkflowStage, number | null>
            },
            causality: {
                withFinalClassification: causalityRow.withFinalClassification ?? 0,
                withoutFinalClassification: causalityRow.withoutFinalClassification ?? 0,
                categories: Object.fromEntries(CAUSALITY_CATEGORIES.map(( category ) =>
                    [category, causalityRow[`category_${ category }`] ?? 0] )) as Record<DashboardCausalityCategory, number>,
                aSubcategories: mapRecord(A_SUBCATEGORY_COLUMNS, ( _column, key ) => causalityRow[`a_${ key }`] ?? 0 )
            }
        };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.indicatorsFailed', lang), 500, 'DASH_007_FETCH_FAILED', error);
    }
}

interface EpiCurveRow {
    weekStart: string;
    serious: number;
    nonSerious: number;
    unclassified: number;
}

type DashboardScope = DashboardEpiCurve['scope'];

const DAY_MS = 24 * 60 * 60 * 1000;

const addIsoDays = (isoDate: string, days: number): string => {
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
}

const resolvePeriodScope = async (
    query: DashboardPeriodQuery,
    authUser: AuthUser | undefined
): Promise<{ userScopeIds: string[] | null; scopeIds: string[] | null; scope: DashboardScope }> => {
    const userScopeIds = await resolveUserGeoScopeIds(authUser);
    const scopeIds = await resolveIndicatorsScopeIds(userScopeIds, query.geoLocationId);
    return {
        userScopeIds,
        scopeIds,
        scope: {
            restricted: scopeIds !== null,
            hasAssignments: userScopeIds === null || userScopeIds.length > 0,
            geoLocationId: query.geoLocationId ?? null
        }
    };
}

const buildPeriodReplacements = (period: DashboardPeriod, scopeIds: string[] | null): Record<string, unknown> => {
    const replacements: Record<string, unknown> = { from: period.from, to: period.to };
    if( scopeIds !== null ) replacements.scopeIds = scopeIds;
    return replacements;
}

const queryEpiCurve = async (universeSql: string, replacements: Record<string, unknown>): Promise<EpiCurveRow[]> =>
    sequelize.query<EpiCurveRow>(
        `WITH u AS (${ universeSql })
        SELECT to_char(u."reportDate" - EXTRACT(DOW FROM u."reportDate")::int, 'YYYY-MM-DD') AS "weekStart",
            COUNT(*) FILTER (WHERE cl."isSeriousEvent" IS TRUE)::int AS "serious",
            COUNT(*) FILTER (WHERE cl."caseId" IS NOT NULL AND cl."isSeriousEvent" IS NOT TRUE)::int AS "nonSerious",
            COUNT(*) FILTER (WHERE cl."caseId" IS NULL)::int AS "unclassified"
        FROM u
        LEFT JOIN "classification" cl ON cl."caseId" = u."caseId" AND cl."isActive" = true
        WHERE u."reportDate" BETWEEN :from AND :to
        GROUP BY 1`,
        { replacements, type: QueryTypes.SELECT }
    );

const buildEpiWeeks = (period: DashboardPeriod, rows: EpiCurveRow[]): DashboardEpiWeek[] => {
    const byWeekStart = new Map(rows.map(( row ) => [row.weekStart, row] ));
    return listEpiWeeks(period.from, period.to).map(( week ) => {
        const row = byWeekStart.get(week.weekStart);
        const serious = row?.serious ?? 0;
        const nonSerious = row?.nonSerious ?? 0;
        const unclassified = row?.unclassified ?? 0;
        return {
            label: week.label,
            epiYear: week.epiYear,
            epiWeek: week.epiWeek,
            weekStart: week.weekStart,
            partial: week.weekStart < period.from || addIsoDays(week.weekStart, 6) > period.to,
            serious,
            nonSerious,
            unclassified,
            total: serious + nonSerious + unclassified
        };
    });
}

// Get Dashboard Epi Curve Service
// Code: ESAVI-DASH-008
const getEpiCurveService = async (query: DashboardPeriodQuery, authUser: AuthUser | undefined, lang: string): Promise<DashboardEpiCurve> => {
    try {
        const { period } = resolveDashboardPeriod({ from: query.from, to: query.to });
        const { scopeIds, scope } = await resolvePeriodScope(query, authUser);

        if( scopeIds !== null && scopeIds.length === 0 ) {
            return { period, scope, weeks: buildEpiWeeks(period, []) };
        }

        const rows = await queryEpiCurve(buildUniverseSql(scopeIds !== null), buildPeriodReplacements(period, scopeIds));

        return { period, scope, weeks: buildEpiWeeks(period, rows) };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.epiCurveFailed', lang), 500, 'DASH_008_FETCH_FAILED', error);
    }
}

const AGE_UNIT_CATALOG_CODE = 'ageUnit';
const SEX_CATALOG_CODE = 'sex';

type DashboardProgrammatic = DashboardDistributions['programmatic'];
type DashboardSexCode = typeof DASHBOARD_SEX_CODES[number];

interface VaccineQueryRow {
    kind: 'item' | 'others' | 'without';
    key: string | null;
    coded: boolean | null;
    label: string | null;
    cases: number;
    serious: number;
    rank: number | null;
}

interface SexAgeRow {
    ageYears: number | null;
    sexValue: string | null;
    total: number;
}

type AdministrationErrorKey = Exclude<keyof DashboardProgrammatic['administrationErrors'], 'anyError'>;
type ColdChainFailureKey = Exclude<keyof DashboardProgrammatic['coldChainFailures'], 'anyFailure'>;

const periodCasesSql = (universeSql: string, recursive = false): string => `WITH ${ recursive ? 'RECURSIVE ' : '' }u AS (${ universeSql }),
        pc AS (
            SELECT u."caseId", u."patientId", u."healthFacilityId", cl."isSeriousEvent" IS TRUE AS "serious"
            FROM u
            LEFT JOIN "classification" cl ON cl."caseId" = u."caseId" AND cl."isActive" = true
            WHERE u."reportDate" BETWEEN :from AND :to
        )`;

const queryVaccines = async (universeSql: string, replacements: Record<string, unknown>): Promise<VaccineQueryRow[]> =>
    sequelize.query<VaccineQueryRow>(
        `${ periodCasesSql(universeSql) },
        sv AS (
            SELECT DISTINCT pc."caseId", pc."serious",
                ${ VACCINE_KEY_SQL('nv') } AS "key",
                nv."vaccineWhodrugId" IS NOT NULL AS "coded",
                CASE WHEN nv."vaccineWhodrugId" IS NOT NULL
                    THEN vw."drugName"
                    ELSE NULLIF(upper(btrim(COALESCE(nv."vaccineName", ''))), '')
                END AS "label"
            FROM pc
            JOIN "notification" n ON n."caseId" = pc."caseId" AND n."isActive" = true
            JOIN "notificationVaccine" nv ON nv."notificationId" = n."notificationId" AND nv."isActive" = true AND nv."isSuspected" = true
            LEFT JOIN "vaccineWhodrug" vw ON vw."vaccineWhodrugId" = nv."vaccineWhodrugId"
        ),
        g AS (
            SELECT sv."key", sv."coded", sv."label",
                COUNT(DISTINCT sv."caseId")::int AS "cases",
                COUNT(DISTINCT sv."caseId") FILTER (WHERE sv."serious")::int AS "serious"
            FROM sv
            GROUP BY sv."key", sv."coded", sv."label"
        ),
        r AS (
            SELECT g.*, ROW_NUMBER() OVER (ORDER BY g."cases" DESC, g."label" ASC NULLS LAST, g."key" ASC)::int AS "rank"
            FROM g
        )
        SELECT 'item' AS "kind", r."key", r."coded", r."label", r."cases", r."serious", r."rank"
        FROM r
        WHERE r."rank" <= :vaccineTopLimit
        UNION ALL
        SELECT 'others', NULL, NULL, NULL,
            COUNT(DISTINCT sv."caseId")::int,
            COUNT(DISTINCT sv."caseId") FILTER (WHERE sv."serious")::int,
            NULL
        FROM sv
        JOIN r ON r."key" = sv."key"
        WHERE r."rank" > :vaccineTopLimit
        UNION ALL
        SELECT 'without', NULL, NULL, NULL,
            COUNT(*)::int, 0, NULL
        FROM pc
        WHERE NOT EXISTS (SELECT 1 FROM sv WHERE sv."caseId" = pc."caseId")`,
        { replacements: { ...replacements, vaccineTopLimit: DASHBOARD_VACCINE_TOP_LIMIT }, type: QueryTypes.SELECT }
    );

const querySexAge = async (universeSql: string, replacements: Record<string, unknown>): Promise<SexAgeRow[]> =>
    sequelize.query<SexAgeRow>(
        `${ periodCasesSql(universeSql) }
        SELECT CASE au."value"
                WHEN 'YEARS' THEN cl."age"
                WHEN 'MONTHS' THEN FLOOR(cl."age"::numeric / 12)
                WHEN 'DAYS' THEN FLOOR(cl."age"::numeric / 365)
            END::int AS "ageYears",
            sx."value" AS "sexValue",
            COUNT(*)::int AS "total"
        FROM pc
        LEFT JOIN "classification" cl ON cl."caseId" = pc."caseId" AND cl."isActive" = true
        LEFT JOIN "catalogItem" au ON au."catalogItemId" = cl."ageUnitItemId"
            AND au."isValueLocked" = true
            AND au."catalogTypeId" = (SELECT "catalogTypeId" FROM "catalogType" WHERE "code" = :ageUnitCatalogCode)
        LEFT JOIN "patient" pt ON pt."patientId" = pc."patientId"
        LEFT JOIN "catalogItem" sx ON sx."catalogItemId" = pt."sexItemId"
            AND sx."isValueLocked" = true
            AND sx."catalogTypeId" = (SELECT "catalogTypeId" FROM "catalogType" WHERE "code" = :sexCatalogCode)
        GROUP BY 1, 2`,
        {
            replacements: { ...replacements, ageUnitCatalogCode: AGE_UNIT_CATALOG_CODE, sexCatalogCode: SEX_CATALOG_CODE },
            type: QueryTypes.SELECT
        }
    );

const ageBandIndexOf = (ageYears: number | null): number => {
    const unknownIndex = DASHBOARD_AGE_BANDS.length - 1;
    if( ageYears === null || ageYears === undefined ) return unknownIndex;
    const index = DASHBOARD_AGE_BANDS.findIndex(( band ) =>
        band.minYears !== null && ageYears >= band.minYears && ( band.maxYears === null || ageYears <= band.maxYears ));
    return index === -1 ? unknownIndex : index;
}

const SEX_CATALOG_VALUES: readonly DashboardSexCode[] = DASHBOARD_SEX_CODES.filter(( code ) => code !== 'NONE' );

const sexIndexOf = (sexValue: string | null): number =>
    DASHBOARD_SEX_CODES.indexOf(SEX_CATALOG_VALUES.includes(sexValue as DashboardSexCode) ? sexValue as DashboardSexCode : 'NONE');

const emptySexAgeMatrix = (): number[][] =>
    DASHBOARD_AGE_BANDS.map(() => DASHBOARD_SEX_CODES.map(() => 0 ));

const buildSexAge = (rows: SexAgeRow[]): DashboardDistributions['sexAge'] => {
    const matrix = emptySexAgeMatrix();
    rows.forEach(( row ) => {
        matrix[ageBandIndexOf(row.ageYears)][sexIndexOf(row.sexValue)] += row.total;
    });
    return {
        bands: DASHBOARD_AGE_BANDS.map(( band ) => band.code ),
        sexes: [...DASHBOARD_SEX_CODES],
        matrix
    };
}

const buildVaccines = (rows: VaccineQueryRow[]): DashboardDistributions['vaccines'] => {
    const items = rows
        .filter(( row ) => row.kind === 'item' )
        .sort(( a, b ) => ( a.rank ?? 0 ) - ( b.rank ?? 0 ))
        .map(( row ): DashboardVaccineRow => ({
            key: row.key as string,
            label: row.label,
            coded: row.coded === true,
            cases: row.cases,
            serious: row.serious
        }));
    const others = rows.find(( row ) => row.kind === 'others' );
    const without = rows.find(( row ) => row.kind === 'without' );
    return {
        items,
        others: { cases: others?.cases ?? 0, serious: others?.serious ?? 0 },
        casesWithoutSuspectedVaccine: without?.cases ?? 0
    };
}

interface GeoReferenceRow {
    geoLocationId: string;
    name: string;
    latitude: number | string | null;
    longitude: number | string | null;
}

interface GeoBucketRow {
    bucket: string | null;
    total: number;
    serious: number;
}

interface GeoReference {
    rows: GeoReferenceRow[];
    selfId: string | null;
}

const SELF_BUCKET = 'self';

const GEO_REFERENCE_COLUMNS = 'g."geoLocationId", g."name", g."latitude", g."longitude"';

const minimizeGeoRootIds = async (rootIds: string[]): Promise<string[]> => {
    if( rootIds.length <= 1 ) return rootIds;
    const nested = await sequelize.query<{ geoLocationId: string }>(
        `WITH RECURSIVE d AS (
            SELECT g."geoLocationId" AS "rootId", g."geoLocationId", 1 AS depth
            FROM "geoLocation" g
            WHERE g."geoLocationId" IN (:rootIds)
              AND g."isActive" = true
            UNION
            SELECT d."rootId", c."geoLocationId", d.depth + 1
            FROM d
            JOIN "geoLocation" c ON c."parentGeoLocationId" = d."geoLocationId"
            WHERE c."isActive" = true
              AND d.depth < :maxDepth
        )
        SELECT DISTINCT d."geoLocationId"
        FROM d
        WHERE d."geoLocationId" IN (:rootIds)
          AND d."geoLocationId" <> d."rootId"`,
        { replacements: { rootIds, maxDepth: MAX_GEO_SUBTREE_DEPTH }, type: QueryTypes.SELECT }
    );
    const nestedIds = new Set(nested.map(( row ) => row.geoLocationId ));
    return rootIds.filter(( id ) => !nestedIds.has(id) );
}

const resolveGeoReference = async (
    query: DashboardPeriodQuery,
    authUser: AuthUser | undefined,
    userScopeIds: string[] | null
): Promise<GeoReference> => {
    if( query.geoLocationId ) {
        const children = await sequelize.query<GeoReferenceRow>(
            `SELECT ${ GEO_REFERENCE_COLUMNS }
            FROM "geoLocation" g
            WHERE g."parentGeoLocationId" = :geoLocationId
              AND g."isActive" = true`,
            { replacements: { geoLocationId: query.geoLocationId }, type: QueryTypes.SELECT }
        );
        if( userScopeIds === null ) return { rows: children, selfId: query.geoLocationId };
        const userScope = new Set(userScopeIds);
        return { rows: children.filter(( row ) => userScope.has(row.geoLocationId) ), selfId: query.geoLocationId };
    }

    if( userScopeIds === null ) {
        const roots = await sequelize.query<GeoReferenceRow>(
            `SELECT ${ GEO_REFERENCE_COLUMNS }
            FROM "geoLocation" g
            WHERE g."parentGeoLocationId" IS NULL
              AND g."isActive" = true`,
            { type: QueryTypes.SELECT }
        );
        return { rows: roots, selfId: null };
    }

    const rootIds = await minimizeGeoRootIds([...new Set(await resolveUserGeoRootIds(authUser))]);
    if( rootIds.length === 0 ) return { rows: [], selfId: null };
    const roots = await sequelize.query<GeoReferenceRow>(
        `SELECT ${ GEO_REFERENCE_COLUMNS }
        FROM "geoLocation" g
        WHERE g."geoLocationId" IN (:rootIds)
          AND g."isActive" = true`,
        { replacements: { rootIds }, type: QueryTypes.SELECT }
    );
    return { rows: roots, selfId: null };
}

const queryGeography = async (
    universeSql: string,
    replacements: Record<string, unknown>,
    reference: GeoReference
): Promise<GeoBucketRow[]> => {
    const referenceIds = reference.rows.map(( row ) => row.geoLocationId );
    const subtreeSql = referenceIds.length > 0
        ? `SELECT g."geoLocationId" AS "rootId", g."geoLocationId", 1 AS depth
            FROM "geoLocation" g
            WHERE g."geoLocationId" IN (:referenceIds)
            UNION
            SELECT t."rootId", c."geoLocationId", t.depth + 1
            FROM t
            JOIN "geoLocation" c ON c."parentGeoLocationId" = t."geoLocationId"
            WHERE c."isActive" = true
              AND t.depth < :maxDepth`
        : 'SELECT NULL::uuid AS "rootId", NULL::uuid AS "geoLocationId", 1 AS depth WHERE false';

    return sequelize.query<GeoBucketRow>(
        `${ periodCasesSql(universeSql, true) },
        t AS (${ subtreeSql }),
        a AS (
            SELECT DISTINCT ON (pc."caseId") pc."caseId", pc."serious",
                CASE WHEN h."geoLocationId" = CAST(:selfId AS uuid) THEN '${ SELF_BUCKET }' ELSE t."rootId"::text END AS "bucket"
            FROM pc
            JOIN "healthFacility" h ON h."healthFacilityId" = pc."healthFacilityId"
            LEFT JOIN t ON t."geoLocationId" = h."geoLocationId"
            ORDER BY pc."caseId", t."rootId"
        )
        SELECT a."bucket", COUNT(*)::int AS "total", COUNT(*) FILTER (WHERE a."serious")::int AS "serious"
        FROM a
        GROUP BY a."bucket"`,
        {
            replacements: { ...replacements, referenceIds, selfId: reference.selfId, maxDepth: MAX_GEO_SUBTREE_DEPTH },
            type: QueryTypes.SELECT
        }
    );
}

const compareGeoRows = (a: DashboardGeoRow, b: DashboardGeoRow): number => {
    if( a.total !== b.total ) return b.total - a.total;
    if( a.name === b.name ) return 0;
    if( a.name === null ) return 1;
    if( b.name === null ) return -1;
    return a.name.localeCompare(b.name);
}

const buildGeography = (reference: GeoReference, buckets: GeoBucketRow[]): DashboardDistributions['geography'] => {
    const byBucket = new Map(buckets.map(( row ) => [row.bucket, row] ));
    const rows: DashboardGeoRow[] = reference.rows.map(( row ) => ({
        geoLocationId: row.geoLocationId,
        kind: 'unit',
        name: row.name,
        latitude: toNullableNumber(row.latitude),
        longitude: toNullableNumber(row.longitude),
        total: byBucket.get(row.geoLocationId)?.total ?? 0,
        serious: byBucket.get(row.geoLocationId)?.serious ?? 0
    }));
    const special = ( kind: 'self' | 'unlocated', bucket: GeoBucketRow | undefined ): void => {
        if( !bucket || bucket.total === 0 ) return;
        rows.push({ geoLocationId: null, kind, name: null, latitude: null, longitude: null, total: bucket.total, serious: bucket.serious });
    };
    special('self', byBucket.get(SELF_BUCKET));
    special('unlocated', byBucket.get(null));
    return { rows: rows.sort(compareGeoRows) };
}

const ADMINISTRATION_ERROR_CONDITIONS: Record<AdministrationErrorKey, string> = {
    prescriptionError: `ae."hadPrescriptionError" = 'YES'`,
    contaminatedVaccine: `ae."hadContaminatedVaccine" = 'YES'`,
    abnormalVaccineConditions: `ae."hadAbnormalVaccineConditions" = 'YES'`,
    preparationError: `ae."hadPreparationError" = 'YES'`,
    handlingError: `ae."hadHandlingError" = 'YES'`,
    improperAdministration: `ae."hadImproperAdministration" = 'YES'`
};

const COLD_CHAIN_FAILURE_CONDITIONS: Record<ColdChainFailureKey, string> = {
    rangeDeviation: 'cc."storageRangeDeviation" IS TRUE',
    procedureNotFollowed: `cc."storageProcedureFollowed" = 'NO'`,
    vaccineNotUsable: `cc."storageVaccineNotUsable" = 'YES'`,
    diluentNotUsable: `cc."storageDiluentNotUsable" = 'YES'`,
    partiallyReconstitutedVaccine: `cc."storagePartiallyReconstitutedVaccine" = 'YES'`,
    otherObjectPresent: `cc."storageOtherObjectPresent" = 'YES'`
};

const anyConditionSql = (conditions: Record<string, string>): string =>
    Object.values(conditions).map(( condition ) => `(${ condition })`).join(' OR ');

const queryProgrammatic = async (universeSql: string, replacements: Record<string, unknown>): Promise<CountRow> => {
    const conditionColumns = (conditions: Record<string, string>, prefix: string): string[] =>
        Object.entries(conditions).map(( [key, condition] ) => `COUNT(*) FILTER (WHERE ${ condition })::int AS "${ prefix }_${ key }"`);

    const [row] = await sequelize.query<CountRow>(
        `${ periodCasesSql(universeSql) }
        SELECT COUNT(*)::int AS "investigatedCases",
            COUNT(*) FILTER (WHERE ae."investigationId" IS NULL)::int AS "withoutAdministrationRecord",
            COUNT(*) FILTER (WHERE cc."investigationId" IS NULL)::int AS "withoutColdChainRecord",
            ${ conditionColumns(ADMINISTRATION_ERROR_CONDITIONS, 'ae').join(',\n            ') },
            COUNT(*) FILTER (WHERE ${ anyConditionSql(ADMINISTRATION_ERROR_CONDITIONS) })::int AS "ae_anyError",
            ${ conditionColumns(COLD_CHAIN_FAILURE_CONDITIONS, 'cc').join(',\n            ') },
            COUNT(*) FILTER (WHERE ${ anyConditionSql(COLD_CHAIN_FAILURE_CONDITIONS) })::int AS "cc_anyFailure"
        FROM pc
        JOIN "investigation" inv ON inv."caseId" = pc."caseId" AND inv."isActive" = true
        LEFT JOIN "investigationAdministrationError" ae ON ae."investigationId" = inv."investigationId" AND ae."deletedAt" IS NULL
        LEFT JOIN "investigationColdChain" cc ON cc."investigationId" = inv."investigationId" AND cc."deletedAt" IS NULL`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const buildProgrammatic = (row: CountRow): DashboardProgrammatic => ({
    investigatedCases: row.investigatedCases ?? 0,
    withoutAdministrationRecord: row.withoutAdministrationRecord ?? 0,
    withoutColdChainRecord: row.withoutColdChainRecord ?? 0,
    administrationErrors: {
        ...mapRecord(ADMINISTRATION_ERROR_CONDITIONS, ( _condition, key ) => row[`ae_${ key }`] ?? 0 ),
        anyError: row.ae_anyError ?? 0
    },
    coldChainFailures: {
        ...mapRecord(COLD_CHAIN_FAILURE_CONDITIONS, ( _condition, key ) => row[`cc_${ key }`] ?? 0 ),
        anyFailure: row.cc_anyFailure ?? 0
    }
});

const emptyProgrammatic = (): DashboardProgrammatic => buildProgrammatic({});

const emptyDistributions = (period: DashboardPeriod, scope: DashboardScope): DashboardDistributions => ({
    period,
    scope,
    vaccines: { items: [], others: { cases: 0, serious: 0 }, casesWithoutSuspectedVaccine: 0 },
    sexAge: buildSexAge([]),
    geography: { rows: [] },
    programmatic: emptyProgrammatic()
});

// Get Dashboard Distributions Service
// Code: ESAVI-DASH-009
const getDistributionsService = async (query: DashboardPeriodQuery, authUser: AuthUser | undefined, lang: string): Promise<DashboardDistributions> => {
    try {
        const { period } = resolveDashboardPeriod({ from: query.from, to: query.to });
        const { userScopeIds, scopeIds, scope } = await resolvePeriodScope(query, authUser);

        if( scopeIds !== null && scopeIds.length === 0 ) {
            return emptyDistributions(period, scope);
        }

        const universeSql = buildUniverseSql(scopeIds !== null);
        const replacements = buildPeriodReplacements(period, scopeIds);
        const geoReference = await resolveGeoReference(query, authUser, userScopeIds);

        const [vaccineRows, sexAgeRows, geoBuckets, programmaticRow] = await Promise.all([
            queryVaccines(universeSql, replacements),
            querySexAge(universeSql, replacements),
            queryGeography(universeSql, replacements, geoReference),
            queryProgrammatic(universeSql, replacements)
        ]);

        return {
            period,
            scope,
            vaccines: buildVaccines(vaccineRows),
            sexAge: buildSexAge(sexAgeRows),
            geography: buildGeography(geoReference, geoBuckets),
            programmatic: buildProgrammatic(programmaticRow)
        };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.distributionsFailed', lang), 500, 'DASH_009_FETCH_FAILED', error);
    }
}

interface BatchAlertRow {
    vaccineKey: string;
    label: string | null;
    coded: boolean;
    batchNumber: string;
    variants: string[];
    cases: number;
    suspectedCases: number;
    serious: number;
    deaths: number;
    expiredAtVaccination: number;
    firstReportDate: string;
    lastReportDate: string;
    facilities: number;
    geoUnits: number;
    expirationDates: string[] | null;
    total: number;
}

interface BatchCountersRow {
    batchesEvaluated: number;
    casesWithoutBatch: number;
}

type BatchThresholds = DashboardBatchAlerts['thresholds'];

const readBatchThreshold = async (code: string, fallback: number, lang: string): Promise<number | null> => {
    let value: number;
    try {
        value = await getAppConfigNumber(code, DASHBOARD_CONFIG_SCOPE, lang);
    } catch (error) {
        if( !( error instanceof AppError && error.code === MISSING_CONFIG_CODE ) ) throw error;
        esaviLog(`ESAVI-DASH-010 - ${ code } missing or invalid, default ${ fallback } applied`, 'warn');
        value = fallback;
    }
    return value < 1 ? null : Math.ceil(value);
}

const readBatchThresholds = async (lang: string): Promise<BatchThresholds> => {
    const [minCases, minSerious] = await Promise.all([
        readBatchThreshold(DASHBOARD_BATCH_MIN_CASES_CODE, DASHBOARD_BATCH_MIN_CASES_DEFAULT, lang),
        readBatchThreshold(DASHBOARD_BATCH_MIN_SERIOUS_CODE, DASHBOARD_BATCH_MIN_SERIOUS_DEFAULT, lang)
    ]);
    return { minCases, minSerious };
}

const batchVaccinesSql = (universeSql: string): string => `WITH u AS (${ universeSql }),
        pc AS (
            SELECT u."caseId", u."healthFacilityId", u."reportDate",
                cl."isSeriousEvent" IS TRUE AS "serious",
                (cl."causedDeath" IS TRUE OR n."deathDate" IS NOT NULL OR EXISTS (
                    SELECT 1 FROM "investigation" inv
                    JOIN "investigationAutopsy" ia ON ia."investigationId" = inv."investigationId" AND ia."deletedAt" IS NULL
                    WHERE inv."caseId" = u."caseId" AND inv."isActive" = true AND ia."isDeath" IS TRUE
                )) AS "death"
            FROM u
            LEFT JOIN "classification" cl ON cl."caseId" = u."caseId" AND cl."isActive" = true
            LEFT JOIN "notification" n ON n."caseId" = u."caseId" AND n."isActive" = true
            WHERE u."reportDate" BETWEEN :from AND :to
        ),
        bv AS (
            SELECT pc."caseId", pc."healthFacilityId", pc."reportDate", pc."serious", pc."death",
                ${ VACCINE_KEY_SQL('nv') } AS "vaccineKey",
                nv."vaccineWhodrugId" IS NOT NULL AS "coded",
                CASE WHEN nv."vaccineWhodrugId" IS NOT NULL
                    THEN vw."drugName"
                    ELSE NULLIF(upper(btrim(COALESCE(nv."vaccineName", ''))), '')
                END AS "label",
                ${ BATCH_NUMBER_NORMALIZED_SQL('nv') } AS "batchNumber",
                btrim(nv."batchNumber") AS "variant",
                nv."isSuspected", nv."vaccinationDate", nv."expirationDate",
                h."geoLocationId"
            FROM pc
            JOIN "notification" n ON n."caseId" = pc."caseId" AND n."isActive" = true
            JOIN "notificationVaccine" nv ON nv."notificationId" = n."notificationId" AND nv."isActive" = true
            LEFT JOIN "vaccineWhodrug" vw ON vw."vaccineWhodrugId" = nv."vaccineWhodrugId"
            LEFT JOIN "healthFacility" h ON h."healthFacilityId" = pc."healthFacilityId"
            WHERE ${ BATCH_NUMBER_NORMALIZED_SQL('nv') } <> ''
        )`;

const queryBatchAlerts = async (universeSql: string, replacements: Record<string, unknown>, thresholds: BatchThresholds): Promise<BatchAlertRow[]> =>
    sequelize.query<BatchAlertRow>(
        `${ batchVaccinesSql(universeSql) },
        g AS (
            SELECT bv."vaccineKey", bv."coded", bv."label", bv."batchNumber",
                (array_agg(DISTINCT bv."variant" ORDER BY bv."variant"))[1:5] AS "variants",
                COUNT(DISTINCT bv."caseId")::int AS "cases",
                COUNT(DISTINCT bv."caseId") FILTER (WHERE bv."isSuspected")::int AS "suspectedCases",
                COUNT(DISTINCT bv."caseId") FILTER (WHERE bv."serious")::int AS "serious",
                COUNT(DISTINCT bv."caseId") FILTER (WHERE bv."death")::int AS "deaths",
                COUNT(DISTINCT bv."caseId") FILTER (WHERE bv."vaccinationDate" > bv."expirationDate")::int AS "expiredAtVaccination",
                to_char(MIN(bv."reportDate"), 'YYYY-MM-DD') AS "firstReportDate",
                to_char(MAX(bv."reportDate"), 'YYYY-MM-DD') AS "lastReportDate",
                COUNT(DISTINCT bv."healthFacilityId")::int AS "facilities",
                COUNT(DISTINCT bv."geoLocationId")::int AS "geoUnits",
                array_agg(DISTINCT to_char(bv."expirationDate", 'YYYY-MM-DD') ORDER BY to_char(bv."expirationDate", 'YYYY-MM-DD'))
                    FILTER (WHERE bv."expirationDate" IS NOT NULL) AS "expirationDates"
            FROM bv
            GROUP BY bv."vaccineKey", bv."coded", bv."label", bv."batchNumber"
        )
        SELECT g.*, COUNT(*) OVER ()::int AS "total"
        FROM g
        WHERE (CAST(:minCases AS int) IS NOT NULL AND g."cases" >= CAST(:minCases AS int))
            OR (CAST(:minSerious AS int) IS NOT NULL AND g."serious" >= CAST(:minSerious AS int))
            OR g."deaths" >= 1
        ORDER BY g."deaths" DESC, g."serious" DESC, g."cases" DESC, g."lastReportDate" DESC, g."batchNumber" ASC, g."vaccineKey" ASC
        LIMIT :batchAlertLimit`,
        {
            replacements: {
                ...replacements,
                minCases: thresholds.minCases,
                minSerious: thresholds.minSerious,
                batchAlertLimit: DASHBOARD_BATCH_ALERT_LIMIT
            },
            type: QueryTypes.SELECT
        }
    );

const queryBatchCounters = async (universeSql: string, replacements: Record<string, unknown>): Promise<BatchCountersRow> => {
    const [row] = await sequelize.query<BatchCountersRow>(
        `${ batchVaccinesSql(universeSql) }
        SELECT
            (SELECT COUNT(*) FROM (SELECT DISTINCT bv."vaccineKey", bv."batchNumber" FROM bv) k)::int AS "batchesEvaluated",
            (SELECT COUNT(*) FROM pc WHERE NOT EXISTS (SELECT 1 FROM bv WHERE bv."caseId" = pc."caseId"))::int AS "casesWithoutBatch"`,
        { replacements, type: QueryTypes.SELECT }
    );
    return row;
}

const batchAlertReasons = (row: BatchAlertRow, thresholds: BatchThresholds): DashboardBatchAlertReason[] => {
    const reasons: DashboardBatchAlertReason[] = [];
    if( thresholds.minCases !== null && row.cases >= thresholds.minCases ) reasons.push('MIN_CASES');
    if( thresholds.minSerious !== null && row.serious >= thresholds.minSerious ) reasons.push('MIN_SERIOUS');
    if( row.deaths >= 1 ) reasons.push('DEATH');
    return reasons;
}

const toBatchAlert = (row: BatchAlertRow, thresholds: BatchThresholds): DashboardBatchAlert => ({
    vaccineKey: row.vaccineKey,
    label: row.label,
    coded: row.coded,
    batchNumber: row.batchNumber,
    variants: row.variants ?? [],
    cases: row.cases,
    suspectedCases: row.suspectedCases,
    serious: row.serious,
    deaths: row.deaths,
    expiredAtVaccination: row.expiredAtVaccination,
    firstReportDate: row.firstReportDate,
    lastReportDate: row.lastReportDate,
    facilities: row.facilities,
    geoUnits: row.geoUnits,
    expirationDates: row.expirationDates ?? [],
    reasons: batchAlertReasons(row, thresholds)
});

const emptyBatchAlerts = (period: DashboardPeriod, scope: DashboardScope, thresholds: BatchThresholds): DashboardBatchAlerts => ({
    period,
    scope,
    thresholds,
    total: 0,
    batchesEvaluated: 0,
    casesWithoutBatch: 0,
    alerts: []
});

// Get Dashboard Batch Alerts Service
// Code: ESAVI-DASH-010
const getBatchAlertsService = async (query: DashboardPeriodQuery, authUser: AuthUser | undefined, lang: string): Promise<DashboardBatchAlerts> => {
    try {
        const { period } = resolveDashboardPeriod({ from: query.from, to: query.to });
        const { scopeIds, scope } = await resolvePeriodScope(query, authUser);
        const thresholds = await readBatchThresholds(lang);

        if( scopeIds !== null && scopeIds.length === 0 ) {
            return emptyBatchAlerts(period, scope, thresholds);
        }

        const universeSql = buildUniverseSql(scopeIds !== null);
        const replacements = buildPeriodReplacements(period, scopeIds);

        const [alertRows, counters] = await Promise.all([
            queryBatchAlerts(universeSql, replacements, thresholds),
            queryBatchCounters(universeSql, replacements)
        ]);

        return {
            period,
            scope,
            thresholds,
            total: alertRows[0]?.total ?? 0,
            batchesEvaluated: counters.batchesEvaluated,
            casesWithoutBatch: counters.casesWithoutBatch,
            alerts: alertRows.map(( row ) => toBatchAlert(row, thresholds) )
        };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.batchAlertsFailed', lang), 500, 'DASH_010_FETCH_FAILED', error);
    }
}

interface ActivityEventRow {
    caseId: string;
    caseCode: string;
    occurredAt: Date;
    method: string;
    user: string | null;
}

interface MyCaseRow {
    caseId: string;
    caseCode: string;
    statusCode: string;
    occurredAt: Date;
    method: string;
}

interface AuthorHolder {
    appDetails: { user: string | null }[];
}

const auditEntriesSql = (column: string): string =>
    `jsonb_array_elements(CASE WHEN jsonb_typeof(${ column }) = 'array' THEN ${ column } ELSE '[]'::jsonb END)`;

const activityEventsSql = (universeSql: string): string => `WITH u AS (${ universeSql }),
        entries AS (
            SELECT u."caseId", u."caseCode", u."statusCode", e."entry"
            FROM u
            JOIN "esaviCase" c ON c."caseId" = u."caseId"
            CROSS JOIN LATERAL ${ auditEntriesSql('c."appDetails"') } AS e("entry")
            UNION ALL
            SELECT u."caseId", u."caseCode", u."statusCode", e."entry"
            FROM u
            JOIN "caseWorkflow" w ON w."caseId" = u."caseId" AND w."isActive" = true
            CROSS JOIN LATERAL ${ auditEntriesSql('w."appDetails"') } AS e("entry")
        ),
        typed AS (
            SELECT en."caseId", en."caseCode", en."statusCode",
                CASE WHEN jsonb_typeof(en."entry" -> 'createdAt') = 'string' AND jsonb_typeof(en."entry" -> 'method') = 'string'
                    THEN (en."entry" ->> 'createdAt')::timestamptz END AS "occurredAt",
                en."entry" ->> 'method' AS "method",
                en."entry" ->> 'user' AS "user"
            FROM entries en
        ),
        events AS (
            SELECT t."caseId", t."caseCode", t."statusCode", t."occurredAt", t."method", t."user"
            FROM typed t
            WHERE t."occurredAt" IS NOT NULL
              AND t."occurredAt" >= now() - make_interval(days => :windowDays)
              AND t."method" NOT IN (:excludedMethods)
        )`;

const queryTerritoryActivity = async (universeSql: string, replacements: Record<string, unknown>): Promise<ActivityEventRow[]> =>
    sequelize.query<ActivityEventRow>(
        `${ activityEventsSql(universeSql) }
        SELECT ev."caseId", ev."caseCode", ev."occurredAt", ev."method", ev."user"
        FROM events ev
        ORDER BY ev."occurredAt" DESC, ev."caseCode" ASC
        LIMIT :activityLimit`,
        { replacements: { ...replacements, activityLimit: DASHBOARD_ACTIVITY_LIMIT }, type: QueryTypes.SELECT }
    );

const queryMyCases = async (universeSql: string, replacements: Record<string, unknown>, userId: string): Promise<MyCaseRow[]> =>
    sequelize.query<MyCaseRow>(
        `${ activityEventsSql(universeSql) },
        mine AS (
            SELECT DISTINCT ON (ev."caseId") ev."caseId", ev."caseCode", ev."statusCode", ev."occurredAt", ev."method"
            FROM events ev
            WHERE ev."user" = :userId
            ORDER BY ev."caseId", ev."occurredAt" DESC
        )
        SELECT m."caseId", m."caseCode", m."statusCode", m."occurredAt", m."method"
        FROM mine m
        ORDER BY m."occurredAt" DESC, m."caseCode" ASC
        LIMIT :myCasesLimit`,
        { replacements: { ...replacements, userId, myCasesLimit: DASHBOARD_MY_CASES_LIMIT }, type: QueryTypes.SELECT }
    );

const toActivityAction = (method: string): DashboardActivityAction => DASHBOARD_ACTIVITY_ACTION_MAP[method] ?? 'OTHER';

const resolveActivityAuthors = async (rows: ActivityEventRow[], canViewAuthors: boolean): Promise<(string | null)[]> => {
    const holders: AuthorHolder[] = rows.map(( row ) => ({ appDetails: [{ user: row.user }] }));
    const resolved = await resolveAppDetailsAuthorsService<AuthorHolder[]>(holders, canViewAuthors);
    return resolved.map(( holder ) => holder.appDetails[0]?.user ?? null );
}

// Get Dashboard Recent Activity Service
// Code: ESAVI-DASH-011
const getRecentActivityService = async (authUser: AuthUser | undefined, lang: string): Promise<DashboardRecentActivity> => {
    try {
        const scopeIds = await resolveUserGeoScopeIds(authUser);
        const scope = { restricted: scopeIds !== null, hasAssignments: scopeIds === null || scopeIds.length > 0 };

        if( scopeIds !== null && scopeIds.length === 0 ) {
            return { windowDays: DASHBOARD_ACTIVITY_WINDOW_DAYS, scope, territory: [], myCases: [] };
        }

        const universeSql = buildUniverseSql(scopeIds !== null);
        const replacements: Record<string, unknown> = {
            windowDays: DASHBOARD_ACTIVITY_WINDOW_DAYS,
            excludedMethods: DASHBOARD_ACTIVITY_EXCLUDED_METHODS
        };
        if( scopeIds !== null ) replacements.scopeIds = scopeIds;

        const [territoryRows, myCaseRows] = await Promise.all([
            queryTerritoryActivity(universeSql, replacements),
            authUser ? queryMyCases(universeSql, replacements, authUser.userId) : Promise.resolve([] as MyCaseRow[])
        ]);

        const authors = await resolveActivityAuthors(territoryRows, canViewAuditAuthors(authUser));

        const territory: DashboardActivityEvent[] = territoryRows.map(( row, index ) => ({
            caseId: row.caseId,
            caseCode: row.caseCode,
            occurredAt: new Date(row.occurredAt).toISOString(),
            method: row.method,
            action: toActivityAction(row.method),
            author: authors[index] ?? null
        }));
        const myCases: DashboardMyCase[] = myCaseRows.map(( row ) => ({
            caseId: row.caseId,
            caseCode: row.caseCode,
            statusCode: row.statusCode,
            lastActionAt: new Date(row.occurredAt).toISOString(),
            lastAction: toActivityAction(row.method)
        }));

        return { windowDays: DASHBOARD_ACTIVITY_WINDOW_DAYS, scope, territory, myCases };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.recentActivityFailed', lang), 500, 'DASH_011_FETCH_FAILED', error);
    }
}

interface SessionCountersRow {
    activeSessions: number;
    activeUsers24h: number;
    activeUsers7d: number;
    sessionsStarted24h: number;
    sessionsStarted7d: number;
}

interface RevocationRow {
    reason: string;
    count: number;
}

const UNSPECIFIED_REVOKE_REASON = 'UNSPECIFIED';
const OTHER_REVOKE_REASON = 'OTHER';

const querySessionCounters = async (): Promise<SessionCountersRow[]> =>
    sequelize.query<SessionCountersRow>(
        `SELECT
            COUNT(*) FILTER (WHERE s."revokedAt" IS NULL AND (s."expiresAt" IS NULL OR s."expiresAt" > now()))::int AS "activeSessions",
            COUNT(DISTINCT s."userId") FILTER (WHERE s."startedAt" >= now() - interval '24 hours')::int AS "activeUsers24h",
            COUNT(DISTINCT s."userId") FILTER (WHERE s."startedAt" >= now() - interval '7 days')::int AS "activeUsers7d",
            COUNT(*) FILTER (WHERE s."startedAt" >= now() - interval '24 hours')::int AS "sessionsStarted24h",
            COUNT(*) FILTER (WHERE s."startedAt" >= now() - interval '7 days')::int AS "sessionsStarted7d"
        FROM "appSession" s
        WHERE s."deletedAt" IS NULL`,
        { type: QueryTypes.SELECT }
    );

const queryRevocations = async (): Promise<RevocationRow[]> =>
    sequelize.query<RevocationRow>(
        `SELECT COALESCE(s."revokedReason", :unspecified) AS "reason", COUNT(*)::int AS "count"
        FROM "appSession" s
        WHERE s."deletedAt" IS NULL
          AND s."revokedAt" >= now() - interval '7 days'
        GROUP BY COALESCE(s."revokedReason", :unspecified)`,
        { replacements: { unspecified: UNSPECIFIED_REVOKE_REASON }, type: QueryTypes.SELECT }
    );

const buildRevocations = (rows: RevocationRow[]): DashboardSystemActivity['revocations7d'] => {
    const known = new Set<string>(SESSION_REVOKE_REASONS);
    const counts = new Map<string, number>(SESSION_REVOKE_REASONS.map(( reason ) => [reason, 0] ));
    let unspecified: number | null = null;
    let other: number | null = null;
    for( const row of rows ) {
        if( known.has(row.reason) ) {
            counts.set(row.reason, ( counts.get(row.reason) ?? 0 ) + row.count);
        } else if( row.reason === UNSPECIFIED_REVOKE_REASON ) {
            unspecified = ( unspecified ?? 0 ) + row.count;
        } else {
            other = ( other ?? 0 ) + row.count;
        }
    }
    const revocations = SESSION_REVOKE_REASONS.map(( reason ) => ({ reason: reason as string, count: counts.get(reason) ?? 0 }));
    if( unspecified !== null ) revocations.push({ reason: UNSPECIFIED_REVOKE_REASON, count: unspecified });
    if( other !== null ) revocations.push({ reason: OTHER_REVOKE_REASON, count: other });
    return revocations;
}

// Get Dashboard System Activity Service
// Code: ESAVI-DASH-012
const getSystemActivityService = async (lang: string): Promise<DashboardSystemActivity> => {
    try {
        const [counterRows, revocationRows] = await Promise.all([
            querySessionCounters(),
            queryRevocations()
        ]);
        const counters = counterRows[0];
        return {
            generatedAt: new Date().toISOString(),
            activeSessions: counters?.activeSessions ?? 0,
            activeUsers24h: counters?.activeUsers24h ?? 0,
            activeUsers7d: counters?.activeUsers7d ?? 0,
            sessionsStarted24h: counters?.sessionsStarted24h ?? 0,
            sessionsStarted7d: counters?.sessionsStarted7d ?? 0,
            revocations7d: buildRevocations(revocationRows)
        };
    } catch (error) {
        if( error instanceof AppError ) throw error;
        throw new AppError(getMessage('dashboard.systemActivityFailed', lang), 500, 'DASH_012_FETCH_FAILED', error);
    }
}

export {
    CAUSALITY_CATEGORY_SQL,
    getBatchAlertsService,
    getDistributionsService,
    getEpiCurveService,
    getIndicatorsService,
    getPendingWorkService,
    getRecentActivityService,
    getSystemActivityService
}
