import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppUser, AppUserGeoLocation, GeoLocation } from '../models';
import { AppError, getMessage } from '../helpers';
import { esaviDecrypt } from '../helpers/crypto.helper';
import { AppDetails, AuthUser, BulkAssignGeoLocationsInput, CreateAppUserGeoLocationInput, ReassignGeoLocationInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// Upper bound for the descendant walk of ESAVI-USERGEO-008. Together with UNION it keeps the
// recursive CTE terminating even if the stored geoLocation tree already contains a cycle,
// which no SQL constraint can detect
const MAX_COVERAGE_DEPTH = 50;

// Shape of one row of the recursive CTE. Raw SQL is outside Sequelize's typing,
// so the contract is declared here rather than inferred
interface CoverageRow {
    geoLocationId: string;
    name: string;
    level: number;
    parentGeoLocationId: string | null;
    isAssigned: boolean;
}

// The PII columns returned for the assigned user, and the geoLocation attributes.
// GeoLocation is listed attribute by attribute on purpose: the full attribute list
// drags the geometry column into every row of every listing
const USER_ATTRIBUTES = ['userId', 'username', 'firstName', 'lastName', 'email'];

const geoLocationInclude = {
    model: GeoLocation,
    as: 'geoLocation',
    attributes: ['geoLocationId', 'name', 'level', 'parentGeoLocationId']
};

// AppUser PII is stored encrypted, so a raw email is useless to any client.
// Null-safe because firstName and lastName are optional columns
const decryptField = (value?: string | null) => value ? esaviDecrypt(value) : value ?? null;

const toUserResponse = (user: AppUser) => ({
    userId: user.userId,
    username: decryptField(user.username),
    firstName: decryptField(user.firstName),
    lastName: decryptField(user.lastName),
    email: decryptField(user.email)
});

const toAssignmentResponse = (assignment: AppUserGeoLocation) => {
    const plain = assignment.toJSON() as Record<string, unknown>;
    if (plain.user) {
        plain.user = toUserResponse(plain.user as AppUser);
    }
    return plain;
}

// Only assignments in force right now: an open-ended validity, or one that has not expired yet.
// Built per call, so the cutoff is the request time and not the moment the module was loaded
const currentValidityFilter = () => ({
    [Op.or]: [
        { validTo: null },
        { validTo: { [Op.gt]: new Date() } }
    ]
});

// ESAVI-USERGEO-001 - Create App User Geo Location Service
// One row per (userId, geoLocationId) pair, forever: the pair is never duplicated, it is reactivated.
// This is stricter than UQ_appUserGeoLocation_active_user_geoLocation, which only covers active rows
// with a null validTo, so the existence check must not filter by isActive, deletedAt or validTo.
const createAppUserGeoLocationService = async (data: CreateAppUserGeoLocationInput, authUser: AuthUser | undefined, lang: string) => {
    const { userId, geoLocationId } = data;
    // Validate that the referenced AppUser exists and is active
    const user = await AppUser.findOne({
        where: { userId, isActive: true },
        attributes: ['userId']
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_001_USER_NOT_FOUND');
    }
    // Validate that the referenced GeoLocation exists and is active
    const geoLocation = await GeoLocation.findOne({
        where: { geoLocationId, isActive: true },
        attributes: ['geoLocationId']
    });
    if (!geoLocation) {
        throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'USERGEO_001_GEOLOC_NOT_FOUND');
    }
    // The CK_appUserGeoLocation_dates CHECK would raise a 500 here, so the range is validated first
    const validFrom = data.validFrom ? new Date(data.validFrom) : new Date();
    const validTo = data.validTo ? new Date(data.validTo) : null;
    if (validTo && validTo <= validFrom) {
        throw new AppError(getMessage('appUserGeoLocation.invalidDateRange', lang), 409, 'USERGEO_001_INVALID_DATE_RANGE');
    }
    const existingAssignment = await AppUserGeoLocation.findOne({
        where: { userId, geoLocationId }
    });
    // An active pair is a duplicate; without this check the partial unique index raises a 23505,
    // which reaches the client as a 500 instead of a 409
    if (existingAssignment && existingAssignment.isActive) {
        throw new AppError(getMessage('appUserGeoLocation.assignmentExists', lang), 409, 'USERGEO_001_ASSIGNMENT_EXISTS');
    }
    // assignedByUserId is audit data: it always comes from the token, never from the body
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-USERGEO-001',
        detail: existingAssignment ? 'Assignment reactivated by create' : 'Assignment created by service'
    };
    if (existingAssignment) {
        const currentAppDetails = Array.isArray(existingAssignment.appDetails) ? existingAssignment.appDetails : [];
        await existingAssignment.update({
            isActive: true,
            deletedAt: null,
            validTo,
            validFrom,
            assignedByUserId: authUser?.userId ?? null,
            updatedAt: new Date(),
            appDetails: [...currentAppDetails, newEntry]
        });
        return { assignment: existingAssignment, created: false };
    }
    const newAssignment = await AppUserGeoLocation.create({
        userId,
        geoLocationId,
        validFrom,
        validTo,
        assignedByUserId: authUser?.userId ?? null,
        isActive: data.isActive !== undefined ? data.isActive : true,
        appDetails: [newEntry]
    });
    return { assignment: newAssignment, created: true };
}

// ESAVI-USERGEO-002A - Get App User Geo Locations By User Service
// `current` defaults to true at the route: whoever reads the operational state of a user
// should not be shown assignments that already expired
const getAppUserGeoLocationsByUserService = async (userId: string, lang: string, current: boolean, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The same user owns every row of this listing, so it is fetched and decrypted once
    // for the whole response rather than per row
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_002A_USER_NOT_FOUND');
    }
    const assignments = await AppUserGeoLocation.findAndCountAll({
        where: {
            userId,
            isActive: true,
            ...( current ? currentValidityFilter() : {} )
        },
        include: [geoLocationInclude],
        order: [['validFrom', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERGEO-002B - Get All App User Geo Locations By User Service - For Admin
// Same listing without the isActive filter, and with `current` defaulting to false at the route
const getAllAppUserGeoLocationsByUserService = async (userId: string, lang: string, current: boolean, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_002B_USER_NOT_FOUND');
    }
    const assignments = await AppUserGeoLocation.findAndCountAll({
        where: {
            userId,
            ...( current ? currentValidityFilter() : {} )
        },
        include: [geoLocationInclude],
        order: [['validFrom', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERGEO-003 - Get App User Geo Location By ID Service
// Unlike the listings, a single row carries its own user: there is no repetition to avoid
const getAppUserGeoLocationByIdService = async (id: string, lang: string, includeInactive: boolean) => {
    const assignment = await AppUserGeoLocation.findOne({
        where: {
            userGeoLocationId: id,
            // A closed assignment is invisible unless the caller can see inactive rows,
            // which today means SUPERADMIN
            ...( includeInactive ? {} : { isActive: true } )
        },
        include: [
            {
                model: AppUser,
                as: 'user',
                attributes: USER_ATTRIBUTES
            },
            geoLocationInclude
        ]
    });
    if (!assignment) {
        throw new AppError(getMessage('appUserGeoLocation.notFound', lang), 404, 'USERGEO_003_NOT_FOUND');
    }
    return toAssignmentResponse(assignment);
}

// ESAVI-USERGEO-004 - Update App User Geo Location Service
// Validity only. Moving an assignment to another geoLocation is ESAVI-USERGEO-006,
// and the validator already rejects userId and geoLocationId with a 400
const updateAppUserGeoLocationService = async (id: string, data: Partial<CreateAppUserGeoLocationInput>, authUser: AuthUser | undefined, lang: string) => {
    const assignment = await AppUserGeoLocation.findByPk(id);
    if (!assignment) {
        throw new AppError(getMessage('appUserGeoLocation.notFound', lang), 404, 'USERGEO_004_NOT_FOUND');
    }
    if (!assignment.isActive) {
        throw new AppError(getMessage('appUserGeoLocation.alreadyInactive', lang, { id }), 409, 'USERGEO_004_ALREADY_INACTIVE');
    }
    // The range is checked against the resulting row, not against the payload: sending only
    // validFrom must still be compared with the validTo already stored
    const targetValidFrom = data.validFrom ? new Date(data.validFrom) : assignment.validFrom;
    const targetValidTo = data.validTo !== undefined
        ? ( data.validTo ? new Date(data.validTo) : null )
        : assignment.validTo ?? null;
    if (targetValidTo && targetValidTo <= targetValidFrom) {
        throw new AppError(getMessage('appUserGeoLocation.invalidDateRange', lang), 409, 'USERGEO_004_INVALID_DATE_RANGE');
    }
    const currentAppDetails = Array.isArray(assignment.appDetails) ? assignment.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-USERGEO-004',
        detail: 'Assignment validity updated by service'
    };
    const objectToUpdate: Record<string, unknown> = {
        validFrom: targetValidFrom.getTime() !== new Date(assignment.validFrom).getTime() ? targetValidFrom : undefined,
        // validTo is nullable, so an explicit null is a real change and cannot be
        // collapsed with "absent" the way the other update services do it
        validTo: data.validTo !== undefined ? targetValidTo : undefined
    };
    if (objectToUpdate.validFrom === undefined) delete objectToUpdate.validFrom;
    if (objectToUpdate.validTo === undefined) delete objectToUpdate.validTo;

    await assignment.update({
        ...objectToUpdate,
        updatedAt: new Date(),
        appDetails: [...currentAppDetails, newEntry]
    });
    return assignment;
}

// ESAVI-USERGEO-005A / 005B - Setting App User Geo Location Active/Inactive Service
// Closing writes validTo alongside isActive and deletedAt: without it a row can end up
// active and expired at once, a state no listing knows how to represent
const setAppUserGeoLocationActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        // Reopening a pair whose twin is already active would break the one-row-per-pair
        // invariant. It can only happen through direct SQL, which the partial index allows
        if (isActive) {
            const assignment = await AppUserGeoLocation.findByPk(id, { transaction });
            if (assignment) {
                const activeTwin = await AppUserGeoLocation.findOne({
                    where: {
                        userId: assignment.userId,
                        geoLocationId: assignment.geoLocationId,
                        userGeoLocationId: { [Op.ne]: id },
                        isActive: true
                    },
                    transaction
                });
                if (activeTwin) {
                    throw new AppError(getMessage('appUserGeoLocation.assignmentExists', lang), 409, 'USERGEO_005B_ASSIGNMENT_EXISTS');
                }
            }
        }
        const assignment = await setEntityActiveStatusService({
            model: AppUserGeoLocation,
            where: { userGeoLocationId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('appUserGeoLocation.notFound', lang),
            notFoundCode: `USERGEO_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`appUserGeoLocation.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `USERGEO_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-USERGEO-${ op }`,
                detail: `Assignment ${ isActive ? 'reopened' : 'closed' } by service`
            }
        });
        // entityActivation.service.ts knows nothing about validTo, so the temporal side of the
        // close is written here, inside the same transaction
        await assignment.update({ validTo: isActive ? null : new Date() }, { transaction });
        await transaction.commit();
        return assignment;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-USERGEO-006 - Reassign App User Geo Location Service
// Two rows change, so the whole thing runs in one transaction: either the user moves,
// or nothing happened. Modelling this as a PUT that swaps geoLocationId would mean an
// update that sometimes creates records
const reassignAppUserGeoLocationService = async (id: string, data: ReassignGeoLocationInput, authUser: AuthUser | undefined, lang: string) => {
    const transaction = await sequelize.transaction();
    try {
        const source = await AppUserGeoLocation.findByPk(id, { transaction });
        if (!source) {
            throw new AppError(getMessage('appUserGeoLocation.notFound', lang), 404, 'USERGEO_006_NOT_FOUND');
        }
        // Moving something already closed has no defined meaning
        if (!source.isActive) {
            throw new AppError(getMessage('appUserGeoLocation.alreadyInactive', lang, { id }), 409, 'USERGEO_006_ALREADY_INACTIVE');
        }
        const targetGeoLocation = await GeoLocation.findOne({
            where: { geoLocationId: data.geoLocationId, isActive: true },
            attributes: ['geoLocationId'],
            transaction
        });
        if (!targetGeoLocation) {
            throw new AppError(getMessage('geoLocation.notFound', lang), 404, 'USERGEO_006_GEOLOC_NOT_FOUND');
        }
        // Without this guard the operation would close and reopen the very same row,
        // leaving two audit entries and no effect
        if (data.geoLocationId === source.geoLocationId) {
            throw new AppError(getMessage('appUserGeoLocation.sameGeoLocation', lang), 409, 'USERGEO_006_SAME_GEOLOCATION');
        }
        const now = new Date();
        const targetEntry: AppDetails = {
            createdAt: now,
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-USERGEO-006',
            detail: `Assignment opened by reassignment from geoLocation ${ source.geoLocationId }`
        };
        // Same pair semantics as ESAVI-USERGEO-001: never duplicated, reactivated instead
        const existingTarget = await AppUserGeoLocation.findOne({
            where: { userId: source.userId, geoLocationId: data.geoLocationId },
            transaction
        });
        if (existingTarget && existingTarget.isActive) {
            throw new AppError(getMessage('appUserGeoLocation.assignmentExists', lang), 409, 'USERGEO_006_ASSIGNMENT_EXISTS');
        }
        let target: AppUserGeoLocation;
        if (existingTarget) {
            const targetAppDetails = Array.isArray(existingTarget.appDetails) ? existingTarget.appDetails : [];
            await existingTarget.update({
                isActive: true,
                deletedAt: null,
                validTo: null,
                validFrom: now,
                assignedByUserId: authUser?.userId ?? null,
                updatedAt: now,
                appDetails: [...targetAppDetails, targetEntry]
            }, { transaction });
            target = existingTarget;
        } else {
            target = await AppUserGeoLocation.create({
                userId: source.userId,
                geoLocationId: data.geoLocationId,
                validFrom: now,
                validTo: null,
                assignedByUserId: authUser?.userId ?? null,
                isActive: true,
                appDetails: [targetEntry]
            }, { transaction });
        }
        // The source is closed exactly like ESAVI-USERGEO-005A does it
        const sourceAppDetails = Array.isArray(source.appDetails) ? source.appDetails : [];
        await source.update({
            isActive: false,
            deletedAt: now,
            validTo: now,
            updatedAt: now,
            appDetails: [...sourceAppDetails, {
                createdAt: now,
                user: authUser?.userId || 'undefined',
                method: 'ESAVI-USERGEO-006',
                detail: `Assignment closed by reassignment to geoLocation ${ data.geoLocationId }`
            }]
        }, { transaction });
        await transaction.commit();
        return target;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-USERGEO-007 - Bulk Assign Geo Locations Service
// All or nothing: it is the only semantics consistent with the rest of the API, which has
// no endpoint with partial success
const bulkAssignGeoLocationsService = async (data: BulkAssignGeoLocationsInput, authUser: AuthUser | undefined, lang: string) => {
    const { userId, geoLocationIds } = data;
    const transaction = await sequelize.transaction();
    try {
        const user = await AppUser.findOne({
            where: { userId, isActive: true },
            attributes: ['userId'],
            transaction
        });
        if (!user) {
            throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_007_USER_NOT_FOUND');
        }
        const validFrom = data.validFrom ? new Date(data.validFrom) : new Date();
        const validTo = data.validTo ? new Date(data.validTo) : null;
        if (validTo && validTo <= validFrom) {
            throw new AppError(getMessage('appUserGeoLocation.invalidDateRange', lang), 409, 'USERGEO_007_INVALID_DATE_RANGE');
        }
        // One query for the whole batch instead of one per id
        const geoLocations = await GeoLocation.findAll({
            where: {
                geoLocationId: { [Op.in]: geoLocationIds },
                isActive: true
            },
            attributes: ['geoLocationId'],
            transaction
        });
        if (geoLocations.length !== geoLocationIds.length) {
            const missing = geoLocationIds.length - geoLocations.length;
            throw new AppError(getMessage('appUserGeoLocation.geoLocationsNotFound', lang, { count: missing }), 404, 'USERGEO_007_GEOLOC_NOT_FOUND');
        }
        const existingAssignments = await AppUserGeoLocation.findAll({
            where: {
                userId,
                geoLocationId: { [Op.in]: geoLocationIds }
            },
            transaction
        });
        // A single active pair aborts the batch before anything is written
        if (existingAssignments.some(( assignment ) => assignment.isActive)) {
            throw new AppError(getMessage('appUserGeoLocation.assignmentExists', lang), 409, 'USERGEO_007_ASSIGNMENT_EXISTS');
        }
        const now = new Date();
        const newEntry: AppDetails = {
            createdAt: now,
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-USERGEO-007',
            detail: 'Assignment created by bulk assignment'
        };
        const existingByGeoLocation = new Map(existingAssignments.map(( assignment ) => [assignment.geoLocationId, assignment]));
        const rows: AppUserGeoLocation[] = [];
        for( const geoLocationId of geoLocationIds ) {
            const existing = existingByGeoLocation.get(geoLocationId);
            // Same pair semantics as ESAVI-USERGEO-001: inactive rows are reactivated, never duplicated
            if (existing) {
                const currentAppDetails = Array.isArray(existing.appDetails) ? existing.appDetails : [];
                await existing.update({
                    isActive: true,
                    deletedAt: null,
                    validTo,
                    validFrom,
                    assignedByUserId: authUser?.userId ?? null,
                    updatedAt: now,
                    appDetails: [...currentAppDetails, { ...newEntry, detail: 'Assignment reactivated by bulk assignment' }]
                }, { transaction });
                rows.push(existing);
                continue;
            }
            rows.push(await AppUserGeoLocation.create({
                userId,
                geoLocationId,
                validFrom,
                validTo,
                assignedByUserId: authUser?.userId ?? null,
                isActive: true,
                appDetails: [newEntry]
            }, { transaction }));
        }
        await transaction.commit();
        return { count: rows.length, rows };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-USERGEO-008 - Resolve User Coverage Service
// The assignment stays one row and the inheritance is resolved on read. Expanding on write
// would multiply the rows and go stale the moment a new child geoLocation is created.
// Read-only: it never writes appDetails
const resolveUserCoverageService = async (userId: string, lang: string) => {
    const user = await AppUser.findOne({
        where: { userId },
        attributes: ['userId']
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERGEO_008_USER_NOT_FOUND');
    }
    // Two guards against a cycle in the stored data: UNION instead of UNION ALL, and an
    // explicit depth cap. With a corrupt tree the query still terminates
    const coverage = await sequelize.query<CoverageRow>(
        `WITH RECURSIVE assigned AS (
            SELECT g."geoLocationId", g."name", g."level", g."parentGeoLocationId"
            FROM "appUserGeoLocation" a
            JOIN "geoLocation" g ON g."geoLocationId" = a."geoLocationId"
            WHERE a."userId" = :userId
              AND a."isActive" = true
              AND ( a."validTo" IS NULL OR a."validTo" > now() )
              AND g."isActive" = true
        ),
        descendants AS (
            SELECT a."geoLocationId", a."name", a."level", a."parentGeoLocationId",
                   true AS "isAssigned", 1 AS depth
            FROM assigned a
            UNION
            SELECT c."geoLocationId", c."name", c."level", c."parentGeoLocationId",
                   false AS "isAssigned", d.depth + 1
            FROM descendants d
            JOIN "geoLocation" c ON c."parentGeoLocationId" = d."geoLocationId"
            WHERE c."isActive" = true
              AND d.depth < :maxDepth
        )
        SELECT "geoLocationId", "name", "level", "parentGeoLocationId",
               bool_or("isAssigned") AS "isAssigned"
        FROM descendants
        GROUP BY "geoLocationId", "name", "level", "parentGeoLocationId"
        ORDER BY "level" ASC, "name" ASC`,
        {
            // Parameterized, never string interpolation
            replacements: { userId, maxDepth: MAX_COVERAGE_DEPTH },
            type: QueryTypes.SELECT
        }
    );
    return {
        assigned: coverage
            .filter(( row ) => row.isAssigned )
            .map(({ geoLocationId, name, level }) => ({ geoLocationId, name, level })),
        // The full expansion, which includes the assigned nodes themselves
        coverage: coverage.map(({ geoLocationId, name, level, parentGeoLocationId }) =>
            ({ geoLocationId, name, level, parentGeoLocationId })),
        count: coverage.length
    };
}

export {
    createAppUserGeoLocationService,
    getAppUserGeoLocationsByUserService,
    getAllAppUserGeoLocationsByUserService,
    getAppUserGeoLocationByIdService,
    updateAppUserGeoLocationService,
    setAppUserGeoLocationActivationService,
    reassignAppUserGeoLocationService,
    bulkAssignGeoLocationsService,
    resolveUserCoverageService
};
