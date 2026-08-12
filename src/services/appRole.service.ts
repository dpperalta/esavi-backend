import { Op } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppError, buildDifferentialUpdate, getMessage, isSuperAdmin, toConstantCase } from '../helpers';
import { AppRole, AppUserRole } from '../models';
import { AppDetails, AuthUser, CreateAppRoleInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { ROLES } from '../constants/roles.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';

// sysDetails is trigger metadata, never part of the domain response
const LIST_EXCLUDE = { exclude: ['sysDetails'] };

// A role list is read from most to least authority; alphabetical would put
// ANALYTICS first and SUPERADMIN last
const LIST_ORDER: [string, string][] = [['level', 'DESC'], ['name', 'ASC']];

// create and update return the row through `returning: true`, which brings the trigger-written
// sysDetails along. Dropped here so 001 and 004 answer with the same shape as a listing row
const toAppRoleResponse = (appRole: AppRole) => {
    const plain = appRole.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    return plain;
}

// Highest level the requester currently holds, taken from the roles tokenValidation reloads
// on every request. validateUserRole cannot express this guard: it compares against a fixed
// threshold declared on the route, not against the level carried in the request body.
// Falls back to 0 so a token without roles can never create anything
const requesterLevel = (authUser?: AuthUser): number =>
    Math.max(0, ...(authUser?.roles ?? []).map(role => role.level ?? 0));

// Create App Role Service
// Code: ESAVI-APPROLE-001
const createAppRoleService = async (data: CreateAppRoleInput, authUser: AuthUser | undefined, lang: string) => {
    // name is normalized with toConstantCase, not toTitleCase: in this table it is the key
    // roleValidation.middleware.ts and the permissions.helper.ts predicates compare against
    const code = toConstantCase(data.code.trim());
    const name = toConstantCase(data.name.trim());
    // Escalation guard: an ADMIN may create roles up to its own level, never above it.
    // Equal level stays allowed, or level 50 would belong to the SUPERADMIN alone
    if( data.level > requesterLevel(authUser) ) {
        throw new AppError(getMessage('appRole.levelExceeded', lang), 403, 'APPROLE_001_LEVEL_EXCEEDED');
    }
    // Uniqueness does not filter by isActive: that is what UQ_appRole_code guarantees, and
    // filtering would let through values Postgres rejects with 23505 — a 500 instead of a 409
    const existingCode = await AppRole.findOne({ where: { code } });
    if( existingCode ) {
        throw new AppError(getMessage('appRole.codeExists', lang, { code }), 409, 'APPROLE_001_CODE_EXISTS');
    }
    // name has no unique constraint in the DDL, but two active roles sharing one would make it
    // undeterminate which level authorizes. Checked the same way as code, for symmetry
    const existingName = await AppRole.findOne({ where: { name } });
    if( existingName ) {
        throw new AppError(getMessage('appRole.nameExists', lang, { name }), 409, 'APPROLE_001_NAME_EXISTS');
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-APPROLE-001',
        detail: 'App role created by service'
    };
    // isSystemRole is written explicitly rather than left to the DDL default: it is an invariant
    // of the spec, not just a promise of the schema. Marking a system role is a seed or SQL job
    const appRole = await AppRole.create({
        code,
        name,
        description: data.description.trim(),
        level: data.level,
        isSystemRole: false,
        isActive: true,
        appDetails: [newEntry]
    });
    return toAppRoleResponse(appRole);
}

// Get Active App Roles Service
// Code: ESAVI-APPROLE-002A
const getActiveAppRolesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    return await AppRole.findAndCountAll({
        where: { isActive: true },
        attributes: LIST_EXCLUDE,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get All App Roles Service - For Admin
// Code: ESAVI-APPROLE-002B
const getAllAppRolesService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    return await AppRole.findAndCountAll({
        attributes: LIST_EXCLUDE,
        order: LIST_ORDER,
        limit,
        offset
    });
}

// Get App Role By ID Service
// Code: ESAVI-APPROLE-003
const getAppRoleByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const where = canViewInactive ? { roleId: id } : { roleId: id, isActive: true };
    const appRole = await AppRole.findOne({ where, attributes: LIST_EXCLUDE });
    if( !appRole ) {
        throw new AppError(getMessage('appRole.notFound', lang), 404, 'APPROLE_003_NOT_FOUND');
    }
    // 005A refuses to retire a role with carriers. Without this count the client only finds out
    // by receiving the 409, and has no other way of asking beforehand
    const activeUserCount = await AppUserRole.count({ where: { roleId: id, isActive: true } });
    return { ...appRole.toJSON(), activeUserCount };
}

// Update App Role Service
// Code: ESAVI-APPROLE-004
const updateAppRoleService = async (id: string, data: Partial<CreateAppRoleInput>, authUser: AuthUser | undefined, lang: string) => {
    const appRole = await AppRole.findByPk(id);
    if( !appRole ) {
        throw new AppError(getMessage('appRole.notFound', lang), 404, 'APPROLE_004_NOT_FOUND');
    }
    // System role guard: it depends on the record being touched, not on the threshold declared
    // on the route, so validateUserRole cannot express it and it lives here
    if( appRole.isSystemRole && !isSuperAdmin(authUser) ) {
        throw new AppError(getMessage('appRole.systemRole', lang), 403, 'APPROLE_004_SYSTEM_ROLE');
    }
    // Lowering the level of a carried role takes authority away from its carriers on their next
    // request. That is the intended consequence of the column being the source of truth:
    // a mistyped level has to be correctable
    if( data.level !== undefined && data.level > requesterLevel(authUser) ) {
        throw new AppError(getMessage('appRole.levelExceeded', lang), 403, 'APPROLE_004_LEVEL_EXCEEDED');
    }
    const code = data.code ? toConstantCase(data.code.trim()) : undefined;
    if( code && code !== appRole.code ) {
        const existingCode = await AppRole.findOne({ where: { code, roleId: { [Op.ne]: id } } });
        if( existingCode ) {
            throw new AppError(getMessage('appRole.codeExists', lang, { code }), 409, 'APPROLE_004_CODE_EXISTS');
        }
    }
    const name = data.name ? toConstantCase(data.name.trim()) : undefined;
    if( name && name !== appRole.name ) {
        const existingName = await AppRole.findOne({ where: { name, roleId: { [Op.ne]: id } } });
        if( existingName ) {
            throw new AppError(getMessage('appRole.nameExists', lang, { name }), 409, 'APPROLE_004_NAME_EXISTS');
        }
    }
    const currentAppDetails = Array.isArray(appRole.appDetails) ? appRole.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. `stored` is the whole
    // row, which is the precondition of the helper
    const stored = appRole.get({ plain: true }) as Record<string, unknown>;
    const objectToUpdate = buildDifferentialUpdate(stored, {
        code,
        name,
        description: data.description ? data.description.trim() : undefined,
        level: data.level
    });
    // Nothing changed: no UPDATE, no updatedAt and no audit entry. An attempt that touched
    // nothing is not a change, and appDetails counts changes, not visits — morgan already has
    // the request in access.log
    if( Object.keys(objectToUpdate).length === 0 ) {
        return toAppRoleResponse(appRole);
    }
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-APPROLE-004',
        detail: 'App role updated by service'
    };
    const updatedAppRole = await appRole.update({
        ...objectToUpdate,
        updatedAt: new Date(),
        appDetails: [...currentAppDetails, newEntry]
    }, { returning: true });
    return toAppRoleResponse(updatedAppRole);
}

// Set App Role Activation Service - For SuperAdmin on activation
// Code: ESAVI-APPROLE-005A / 005B
const setAppRoleActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const appRole = await AppRole.findByPk(id);
    if( !appRole ) {
        throw new AppError(getMessage('appRole.notFound', lang), 404, `APPROLE_${ op }_NOT_FOUND`);
    }
    if( !isActive ) {
        // System role guard. It is not written for 005B: that route already demands SUPERADMIN,
        // so the check would be dead code
        if( appRole.isSystemRole && !isSuperAdmin(authUser) ) {
            throw new AppError(getMessage('appRole.systemRole', lang), 403, 'APPROLE_005A_SYSTEM_ROLE');
        }
        // Retiring SUPERADMIN would leave nobody able to run 005B, which demands that very role,
        // and the only way back would be SQL against production. Blocked even without carriers.
        // Comparing by code works because the seed aligns code with name
        if( appRole.code === ROLES.SUPERADMIN ) {
            throw new AppError(getMessage('appRole.superAdminRole', lang), 409, 'APPROLE_005A_SUPERADMIN_ROLE');
        }
        // Carriers must be revoked first, or they end up pointing at an inactive role that no
        // listing knows how to represent. Revoking is SPEC F02's job and stays explicit
        const count = await AppUserRole.count({ where: { roleId: id, isActive: true } });
        if( count > 0 ) {
            throw new AppError(getMessage('appRole.hasActiveAssignments', lang, { count }), 409, 'APPROLE_005A_HAS_ACTIVE_ASSIGNMENTS');
        }
    } else {
        // A role retired long ago may find its code or name taken by a role created since
        const existingCode = await AppRole.findOne({
            where: { code: appRole.code, isActive: true, roleId: { [Op.ne]: id } }
        });
        if( existingCode ) {
            throw new AppError(getMessage('appRole.codeExists', lang, { code: appRole.code }), 409, 'APPROLE_005B_CODE_EXISTS');
        }
        const existingName = await AppRole.findOne({
            where: { name: appRole.name, isActive: true, roleId: { [Op.ne]: id } }
        });
        if( existingName ) {
            throw new AppError(getMessage('appRole.nameExists', lang, { name: appRole.name }), 409, 'APPROLE_005B_NAME_EXISTS');
        }
    }
    const transaction = await sequelize.transaction();
    try {
        const updatedAppRole = await setEntityActiveStatusService({
            model: AppRole,
            where: { roleId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('appRole.notFound', lang),
            notFoundCode: `APPROLE_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`appRole.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `APPROLE_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-APPROLE-${ op }`,
                detail: `AppRole ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
        return updatedAppRole;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createAppRoleService,
    getActiveAppRolesService,
    getAllAppRolesService,
    getAppRoleByIdService,
    updateAppRoleService,
    setAppRoleActivationService
}
