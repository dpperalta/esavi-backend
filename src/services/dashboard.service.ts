import { QueryTypes } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType } from '../models';
import { AppError, esaviLog, getAppConfigNumber, getMessage, resolveDashboardPeriod } from '../helpers';
import {
    AuthUser,
    CaseWorkflowStage,
    DashboardASubcategory,
    DashboardCausalityCategory,
    DashboardComparable,
    DashboardIndicators,
    DashboardPendingInvestigation,
    DashboardPendingWork,
    DashboardPeriod,
    DashboardPeriodQuery,
    DashboardSeverityCriterion,
    DashboardStalledCase,
    DashboardStatusCount
} from '../types';
import { CASE_WORKFLOW_STAGE_FIELD, CASE_WORKFLOW_STAGES, CASE_WORKFLOW_STATUS, CASE_WORKFLOW_STATUS_CATALOG_CODE } from '../constants/caseWorkflow.constants';
import {
    DASHBOARD_CONFIG_SCOPE,
    DASHBOARD_STALE_DAYS_CODE,
    DASHBOARD_TOP_LIMIT,
    NOTIFICATION_CONFIG_SCOPE,
    NOTIFICATION_DEADLINE_DAYS_CODE
} from '../constants/dashboard.constants';
import { FINAL_CLASSIFICATION_IMPORTANCE_CATALOG_CODE, FINAL_CLASSIFICATION_TOP_IMPORTANCE_VALUE } from '../constants/finalClassification.constants';
import { resolveGeoSubtreeIds, resolveUserGeoScopeIds } from './common/geoScope.service';

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
    SELECT c."caseId", c."caseCode", c."reportDate", c."eventDate", s."code" AS "statusCode", w."statusItemId", w."openedAt", w."closedAt",
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

export {
    CAUSALITY_CATEGORY_SQL,
    getIndicatorsService,
    getPendingWorkService
}
