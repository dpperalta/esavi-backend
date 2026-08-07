import { AppRole, AppUser, AppUserRole } from '../models';
import { AppError, getMessage } from '../helpers';
import { esaviDecrypt } from '../helpers/crypto.helper';
import { AppDetails, AuthUser, CreateAppUserRoleInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The PII columns returned for the assigned user, and the appRole attributes.
// Both are listed column by column so no listing drags the password hash or the audit JSONB along
const USER_ATTRIBUTES = ['userId', 'username', 'firstName', 'lastName', 'email'];
const ROLE_ATTRIBUTES = ['roleId', 'code', 'name', 'level'];

const roleInclude = {
    model: AppRole,
    as: 'role',
    attributes: ROLE_ATTRIBUTES
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

export {
    assignAppUserRoleService,
    getAppUserRolesByUserService,
    getAllAppUserRolesByUserService
};
