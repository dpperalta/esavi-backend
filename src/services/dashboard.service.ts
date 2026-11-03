import { QueryTypes } from 'sequelize';
import { sequelize } from '../database/connection';
import { CatalogItem, CatalogType } from '../models';
import { AppError, esaviLog, getAppConfigNumber, getMessage } from '../helpers';
import { AuthUser, CaseWorkflowStage, DashboardPendingInvestigation, DashboardPendingWork, DashboardStalledCase, DashboardStatusCount } from '../types';
import { CASE_WORKFLOW_STAGE_FIELD, CASE_WORKFLOW_STAGES, CASE_WORKFLOW_STATUS, CASE_WORKFLOW_STATUS_CATALOG_CODE } from '../constants/caseWorkflow.constants';
import { DASHBOARD_CONFIG_SCOPE, DASHBOARD_STALE_DAYS_CODE, DASHBOARD_TOP_LIMIT } from '../constants/dashboard.constants';
import { resolveUserGeoScopeIds } from './common/geoScope.service';

const MISSING_CONFIG_CODE = 'APPCONFIG_VALUE_MISSING';

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
    SELECT c."caseId", c."caseCode", s."code" AS "statusCode", w."statusItemId", w."openedAt",
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

export {
    getPendingWorkService
}
