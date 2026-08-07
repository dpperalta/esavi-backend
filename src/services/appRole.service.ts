import { AppError, getMessage, toConstantCase } from '../helpers';
import { AppRole } from '../models';
import { AppDetails, AuthUser, CreateAppRoleInput } from '../types';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// sysDetails is trigger metadata, never part of the domain response
const LIST_EXCLUDE = { exclude: ['sysDetails'] };

// A role list is read from most to least authority; alphabetical would put
// ANALYTICS first and SUPERADMIN last
const LIST_ORDER: [string, string][] = [['level', 'DESC'], ['name', 'ASC']];

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
    return await AppRole.create({
        code,
        name,
        description: data.description.trim(),
        level: data.level,
        isSystemRole: false,
        isActive: true,
        appDetails: [newEntry]
    });
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

export {
    createAppRoleService,
    getActiveAppRolesService,
    getAllAppRolesService
}
