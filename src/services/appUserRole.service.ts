import { Op } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppRole, AppUser, AppUserRole } from '../models';
import { AppError, getMessage } from '../helpers';
import { esaviDecrypt } from '../helpers/crypto.helper';
import { AppDetails, AuthUser, BulkAssignRolesInput, CreateAppUserRoleInput } from '../types';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { ROLES } from '../constants/roles.constants';

// The PII columns returned for the assigned user, and the appRole attributes.
// Both are listed column by column so no listing drags the password hash or the audit JSONB along
const USER_ATTRIBUTES = ['userId', 'username', 'firstName', 'lastName', 'email'];
const ROLE_ATTRIBUTES = ['roleId', 'code', 'name', 'level'];

const roleInclude = {
    model: AppRole,
    as: 'role',
    attributes: ROLE_ATTRIBUTES
};

const userInclude = {
    model: AppUser,
    as: 'user',
    attributes: USER_ATTRIBUTES
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

const toAssignmentResponse = (assignment: AppUserRole) => {
    const plain = assignment.toJSON() as Record<string, unknown>;
    if (plain.user) {
        plain.user = toUserResponse(plain.user as AppUser);
    }
    return plain;
}

// Highest level the requester currently holds. validateUserRole cannot express this guard:
// it compares against a fixed threshold declared on the route, not against the request body.
// Falls back to 0 so a token without roles can never assign anything
const requesterLevel = (authUser?: AuthUser): number => {
    const levels = (authUser?.roles ?? []).map(role => role.level).filter(level => typeof level === 'number');
    return levels.length ? Math.max(...levels) : 0;
}

// ESAVI-USERROLE-001 - Assign App User Role Service
// One row per (userId, roleId) pair, forever: the pair is never duplicated, it is reactivated.
// This is stricter than UQ_appUserRole_active_user_role, which only covers active rows,
// so the existence check must not filter by isActive or deletedAt.
// validFrom and validTo are never written: isActive alone governs the state of an assignment
const assignAppUserRoleService = async (data: CreateAppUserRoleInput, authUser: AuthUser | undefined, lang: string) => {
    const { userId, roleId } = data;
    // Validate that the referenced AppUser exists and is active
    const user = await AppUser.findOne({
        where: { userId, isActive: true },
        attributes: ['userId']
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERROLE_001_USER_NOT_FOUND');
    }
    // Validate that the referenced AppRole exists and is active
    const role = await AppRole.findOne({
        where: { roleId, isActive: true },
        attributes: ['roleId', 'level']
    });
    if (!role) {
        throw new AppError(getMessage('role.notFound', lang), 404, 'USERROLE_001_ROLE_NOT_FOUND');
    }
    // Escalation guard: an ADMIN may create ADMINs, never SUPERADMINs. Assigning oneself a role
    // of equal or lower level stays allowed, or the only SUPERADMIN of a fresh install would be stuck
    if (role.level > requesterLevel(authUser)) {
        throw new AppError(getMessage('appUserRole.roleLevelExceeded', lang), 403, 'USERROLE_001_ROLE_LEVEL_EXCEEDED');
    }
    const existingAssignment = await AppUserRole.findOne({
        where: { userId, roleId }
    });
    // An active pair is a duplicate; without this check the partial unique index raises a 23505,
    // which reaches the client as a 500 instead of a 409
    if (existingAssignment && existingAssignment.isActive) {
        throw new AppError(getMessage('appUserRole.assignmentExists', lang), 409, 'USERROLE_001_ASSIGNMENT_EXISTS');
    }
    // assignedByUserId is audit data: it always comes from the token, never from the body
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-USERROLE-001',
        detail: existingAssignment ? 'Role reactivated by assign' : 'Role assigned by service'
    };
    if (existingAssignment) {
        const currentAppDetails = Array.isArray(existingAssignment.appDetails) ? existingAssignment.appDetails : [];
        await existingAssignment.update({
            isActive: true,
            deletedAt: null,
            assignedByUserId: authUser?.userId ?? null,
            updatedAt: new Date(),
            appDetails: [...currentAppDetails, newEntry]
        });
        return { assignment: toAssignmentResponse(existingAssignment), created: false };
    }
    const newAssignment = await AppUserRole.create({
        userId,
        roleId,
        assignedByUserId: authUser?.userId ?? null,
        isActive: true,
        appDetails: [newEntry]
    });
    return { assignment: toAssignmentResponse(newAssignment), created: true };
}

// ESAVI-USERROLE-002A - Get App User Roles By User Service
// Only the assignments in force: a revoked role must not look like a privilege the user still holds
const getAppUserRolesByUserService = async (userId: string, lang: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The same user owns every row of this listing, so it is fetched and decrypted once
    // for the whole response rather than per row
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERROLE_002A_USER_NOT_FOUND');
    }
    const assignments = await AppUserRole.findAndCountAll({
        where: { userId, isActive: true },
        include: [roleInclude],
        order: [['createdAt', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERROLE-002B - Get All App User Roles By User Service - For Admin
// Same listing without the isActive filter: administration needs to see what was revoked
const getAllAppUserRolesByUserService = async (userId: string, lang: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const user = await AppUser.findOne({
        where: { userId },
        attributes: USER_ATTRIBUTES
    });
    if (!user) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USERROLE_002B_USER_NOT_FOUND');
    }
    const assignments = await AppUserRole.findAndCountAll({
        where: { userId },
        include: [roleInclude],
        order: [['createdAt', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        user: toUserResponse(user),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERROLE-003 - Get App User Role By ID Service
// A revoked assignment is a 404 unless the requester can see inactive rows, which today
// means SUPERADMIN. includeInactive is resolved at the controller with canViewInactive
const getAppUserRoleByIdService = async (id: string, lang: string, includeInactive: boolean = false) => {
    const assignment = await AppUserRole.findOne({
        where: {
            userRoleId: id,
            ...( includeInactive ? {} : { isActive: true } )
        },
        include: [userInclude, roleInclude]
    });
    if (!assignment) {
        throw new AppError(getMessage('appUserRole.notFound', lang), 404, 'USERROLE_003_NOT_FOUND');
    }
    return toAssignmentResponse(assignment);
}

// ESAVI-USERROLE-007 - Bulk Assign Roles Service
// All or nothing inside one transaction: a single failing role leaves the batch unwritten,
// so the caller never has to work out which half of the request landed
const bulkAssignRolesService = async (data: BulkAssignRolesInput, authUser: AuthUser | undefined, lang: string) => {
    const { userId, roleIds } = data;
    const transaction = await sequelize.transaction();
    try {
        const user = await AppUser.findOne({
            where: { userId, isActive: true },
            attributes: ['userId'],
            transaction
        });
        if (!user) {
            throw new AppError(getMessage('user.notFound', lang), 404, 'USERROLE_007_USER_NOT_FOUND');
        }
        // One query for the whole batch instead of one per id
        const roles = await AppRole.findAll({
            where: {
                roleId: { [Op.in]: roleIds },
                isActive: true
            },
            attributes: ['roleId', 'level'],
            transaction
        });
        if (roles.length !== roleIds.length) {
            const missing = roleIds.length - roles.length;
            throw new AppError(getMessage('appUserRole.rolesNotFound', lang, { count: missing }), 404, 'USERROLE_007_ROLES_NOT_FOUND');
        }
        // The escalation guard covers every requested role, and it runs before anything is written:
        // one role above the requester's level aborts the whole batch
        const level = requesterLevel(authUser);
        if (roles.some(( role ) => role.level > level)) {
            throw new AppError(getMessage('appUserRole.roleLevelExceeded', lang), 403, 'USERROLE_007_ROLE_LEVEL_EXCEEDED');
        }
        const existingAssignments = await AppUserRole.findAll({
            where: {
                userId,
                roleId: { [Op.in]: roleIds }
            },
            transaction
        });
        // A single active pair aborts the batch before anything is written
        if (existingAssignments.some(( assignment ) => assignment.isActive)) {
            throw new AppError(getMessage('appUserRole.assignmentExists', lang), 409, 'USERROLE_007_ASSIGNMENT_EXISTS');
        }
        const now = new Date();
        const newEntry: AppDetails = {
            createdAt: now,
            user: authUser?.userId || 'undefined',
            method: 'ESAVI-USERROLE-007',
            detail: 'Role assigned by bulk assignment'
        };
        const existingByRole = new Map(existingAssignments.map(( assignment ) => [assignment.roleId, assignment]));
        const rows: AppUserRole[] = [];
        for( const roleId of roleIds ) {
            const existing = existingByRole.get(roleId);
            // Same pair semantics as ESAVI-USERROLE-001: inactive rows are reactivated, never duplicated
            if (existing) {
                const currentAppDetails = Array.isArray(existing.appDetails) ? existing.appDetails : [];
                await existing.update({
                    isActive: true,
                    deletedAt: null,
                    assignedByUserId: authUser?.userId ?? null,
                    updatedAt: now,
                    appDetails: [...currentAppDetails, { ...newEntry, detail: 'Role reactivated by bulk assignment' }]
                }, { transaction });
                rows.push(existing);
                continue;
            }
            rows.push(await AppUserRole.create({
                userId,
                roleId,
                assignedByUserId: authUser?.userId ?? null,
                isActive: true,
                appDetails: [newEntry]
            }, { transaction }));
        }
        await transaction.commit();
        return { count: rows.length, rows: rows.map(toAssignmentResponse) };
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// ESAVI-USERROLE-006 - Get App User Roles By Role Service - For Admin
// Answers "who is SUPERADMIN today". Here the user does travel inside every row and gets
// decrypted per row: identifying the users is the whole point of the endpoint
const getAppUserRolesByRoleService = async (roleId: string, lang: string, limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // The same role owns every row of this listing, so it is fetched once for the whole response
    const role = await AppRole.findOne({
        where: { roleId },
        attributes: ROLE_ATTRIBUTES
    });
    if (!role) {
        throw new AppError(getMessage('role.notFound', lang), 404, 'USERROLE_006_ROLE_NOT_FOUND');
    }
    const assignments = await AppUserRole.findAndCountAll({
        where: { roleId, isActive: true },
        include: [userInclude],
        order: [['createdAt', 'DESC']],
        limit,
        offset
    });
    return {
        count: assignments.count,
        role: role.toJSON(),
        rows: assignments.rows.map(toAssignmentResponse)
    };
}

// ESAVI-USERROLE-005A / 005B - Setting App User Role Active/Inactive Service
// Revoking is the operation this whole spec exists for, so it carries two guards that
// entityActivation.service.ts knows nothing about. validTo is never touched: isActive governs
const setAppUserRoleActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        const assignment = await AppUserRole.findByPk(id, { transaction });
        if (assignment && !isActive) {
            // Last SUPERADMIN guard. 005B requires SUPERADMIN, so revoking the last active one
            // would leave nobody able to undo it and direct SQL as the only way back.
            // The role is matched by code, the only column with a UNIQUE constraint
            const role = await AppRole.findOne({
                where: { roleId: assignment.roleId },
                attributes: ['roleId', 'code'],
                transaction
            });
            if (role && role.code === ROLES.SUPERADMIN) {
                // A SUPERADMIN sitting on a deactivated user cannot log in, so it is no lifeline
                const activeSuperAdmins = await AppUserRole.count({
                    where: { roleId: assignment.roleId, isActive: true },
                    include: [{
                        model: AppUser,
                        as: 'user',
                        attributes: [],
                        where: { isActive: true },
                        required: true
                    }],
                    distinct: true,
                    col: 'userRoleId',
                    transaction
                });
                if (activeSuperAdmins === 1) {
                    throw new AppError(getMessage('appUserRole.lastSuperAdmin', lang), 409, 'USERROLE_005A_LAST_SUPERADMIN');
                }
            }
        }
        // Reopening a pair whose twin is already active would break the one-row-per-pair
        // invariant. It can only happen through direct SQL, which the partial index allows
        if (assignment && isActive) {
            const activeTwin = await AppUserRole.findOne({
                where: {
                    userId: assignment.userId,
                    roleId: assignment.roleId,
                    userRoleId: { [Op.ne]: id },
                    isActive: true
                },
                transaction
            });
            if (activeTwin) {
                throw new AppError(getMessage('appUserRole.assignmentExists', lang), 409, 'USERROLE_005B_ASSIGNMENT_EXISTS');
            }
        }
        const updated = await setEntityActiveStatusService({
            model: AppUserRole,
            where: { userRoleId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('appUserRole.notFound', lang),
            notFoundCode: `USERROLE_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`appUserRole.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `USERROLE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-USERROLE-${ op }`,
                detail: `Role ${ isActive ? 'reinstated' : 'revoked' } by service`
            }
        });
        await transaction.commit();
        return updated;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    assignAppUserRoleService,
    getAppUserRolesByUserService,
    getAllAppUserRolesByUserService,
    getAppUserRoleByIdService,
    getAppUserRolesByRoleService,
    setAppUserRoleActivationService,
    bulkAssignRolesService
};
