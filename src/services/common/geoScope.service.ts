import { QueryTypes } from 'sequelize';
import { sequelize } from '../../database/connection';
import { AuthUser } from '../../types';
import { isAdmin } from '../../helpers/permissions.helper';

// Upper bound for the descendant walk shared by every consumer of the geoLocation subtree:
// the explicit filter of SPEC F48, the coverage of ESAVI-USERGEO-008 and the scope of SPEC F49.
// Together with UNION it keeps the recursive CTE terminating even if the stored geoLocation tree
// already contains a cycle, which no SQL constraint can detect — CK_geoLocation_notSelfParent only
// rules out A being its own parent, not A -> B -> A
const MAX_GEO_SUBTREE_DEPTH = 50;

// Shape of one row of the recursive CTE. Raw SQL is outside Sequelize's typing,
// so the contract is declared here rather than inferred
interface GeoSubtreeRow {
    geoLocationId: string;
}

// Expands a set of geoLocation roots into themselves plus every active descendant, at any depth.
// Read-only, and deliberately without a transaction: it is a SELECT
const resolveGeoSubtreeIds = async (rootIds: string[]): Promise<string[]> => {
    if( rootIds.length === 0 ) return [];
    // Two guards against a cycle in the stored data: UNION instead of UNION ALL, and an
    // explicit depth cap. With a corrupt tree the query still terminates
    const subtree = await sequelize.query<GeoSubtreeRow>(
        `WITH RECURSIVE subtree AS (
            SELECT g."geoLocationId", 1 AS depth
            FROM "geoLocation" g
            WHERE g."geoLocationId" IN (:rootIds)
              AND g."isActive" = true
            UNION
            SELECT c."geoLocationId", s.depth + 1
            FROM subtree s
            JOIN "geoLocation" c ON c."parentGeoLocationId" = s."geoLocationId"
            WHERE c."isActive" = true
              AND s.depth < :maxDepth
        )
        SELECT "geoLocationId" FROM subtree`,
        {
            // Parameterized, never string interpolation
            replacements: { rootIds, maxDepth: MAX_GEO_SUBTREE_DEPTH },
            type: QueryTypes.SELECT
        }
    );
    return subtree.map(( row ) => row.geoLocationId );
}

interface UserGeoRootRow {
    geoLocationId: string;
}

// The geographic scope of a user: null for an administrator (no restriction, same convention as
// buildFacilityInclude), or the list of geoLocationId the user's active appUserGeoLocation
// assignments expand to. An authUser without assignments gets [], which is scope, not "sees all".
// authUser absent is treated as empty scope, not as an admin — the default of a control is closed
const resolveUserGeoScopeIds = async (authUser?: AuthUser): Promise<string[] | null> => {
    if( isAdmin(authUser) ) return null;
    if( !authUser ) return [];

    const roots = await sequelize.query<UserGeoRootRow>(
        `SELECT a."geoLocationId"
        FROM "appUserGeoLocation" a
        JOIN "geoLocation" g ON g."geoLocationId" = a."geoLocationId"
        WHERE a."userId" = :userId
          AND a."isActive" = true
          AND a."deletedAt" IS NULL
          AND ( a."validTo" IS NULL OR a."validTo" > now() )
          AND g."isActive" = true`,
        {
            replacements: { userId: authUser.userId },
            type: QueryTypes.SELECT
        }
    );
    const rootIds = roots.map(( row ) => row.geoLocationId );
    if( rootIds.length === 0 ) return [];

    return resolveGeoSubtreeIds(rootIds);
}

export { MAX_GEO_SUBTREE_DEPTH, resolveGeoSubtreeIds, resolveUserGeoScopeIds };
