import bcrypt from 'bcrypt';
import { Op } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppRole, AppUser, AppUserRole, CatalogItem, CatalogType } from '../models';
import { AppDetails, AuthUser, CreateUserInput, CreateUserServiceParams } from '../types';
import { AppError, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';

// The catalog statusItemId must belong to. Validated in the service: appUser has no
// trigger checking the item against its catalog, unlike healthFacility
const USER_STATUS_CATALOG_CODE = 'userStatus';

// Encrypted columns. Normalized before encrypting: normalizing afterwards would produce a
// different ciphertext for the same value and break the equality lookups the fixed IV allows
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

// Highest level the requester currently holds, taken from the roles tokenValidation reloads
// on every request. validateUserRole cannot express this guard: it compares against a fixed
// threshold declared on the route, not against the roles carried in the request body.
// Falls back to 0 so a token without roles can never create anything
const requesterLevel = (authUser?: AuthUser): number =>
    Math.max(0, ...(authUser?.roles ?? []).map(role => role.level ?? 0));

// Roles are read through the many-to-many association; level travels along for the
// escalation guard and for the response shape
const ROLES_INCLUDE = {
    model: AppRole,
    as: 'roles',
    through: { attributes: [] },
    attributes: ['roleId', 'name', 'code', 'level']
};

// The status catalog item, when the user carries one
const STATUS_INCLUDE = {
    model: CatalogItem,
    as: 'status',
    attributes: ['catalogItemId', 'code', 'name']
};

// passwordHash and sysDetails never leave the service
const LIST_EXCLUDE = { exclude: ['passwordHash', 'sysDetails'] };

// A user list is read newest first. Alphabetical is impossible: the names are encrypted and
// ORDER BY would sort by the ciphertext
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// sysDetails is trigger metadata and passwordHash never leaves the service. The five
// encrypted columns are returned in clear text
const toUserResponse = (user: AppUser) => {
    const plain = user.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.passwordHash;
    for (const field of ['username', 'email', 'displayName', 'firstName', 'lastName']) {
        const value = plain[field];
        plain[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

// The audit history of every user multiplied by the page size makes the response unreadable.
// Whoever needs it asks for the user through 003
const toUserListRow = (user: AppUser) => {
    const plain = toUserResponse(user);
    delete plain.appDetails;
    return plain;
}

// Create User Service
// Code: ESAVI-USER-001
const createUserService = async ({ data, authUser, lang }: CreateUserServiceParams) => {
    const transaction = await sequelize.transaction();
    const { email, password, username, firstName, lastName, phone, statusItemId, roleId } = data;
    const { userId: creatorId } = authUser || {};
    try {
        // Normalization happens before encryption, and displayName is composed from the
        // already normalized names so it always matches what is stored
        const normalizedEmail = normalizeEmail(email);
        const normalizedFirstName = toTitleCase(firstName.trim());
        const normalizedLastName = toTitleCase(lastName.trim());
        const normalizedUsername = username?.trim();
        // Uniqueness does not filter by isActive: that is what UQ_appUser_email guarantees, and
        // filtering would let through values Postgres rejects with 23505 — a 500 instead of a 409
        const existingUser = await AppUser.findOne({
            where: { email: esaviCrypt(normalizedEmail) },
            transaction
        });
        if( existingUser ) {
            throw new AppError(getMessage('user.alreadyExists', lang), 409, 'USER_001_EMAIL_EXISTS');
        }
        // username is optional, but UQ_appUser_username applies just the same when it comes
        if( normalizedUsername ) {
            const existingUsername = await AppUser.findOne({
                where: { username: esaviCrypt(normalizedUsername) },
                transaction
            });
            if( existingUsername ) {
                throw new AppError(getMessage('user.usernameExists', lang, { username: normalizedUsername }), 409, 'USER_001_USERNAME_EXISTS');
            }
        }
        // Validate that the referenced CatalogItem for user status exists, is active and
        // belongs to the userStatus catalog
        if( statusItemId ) {
            const status = await CatalogItem.findOne({
                where: {
                    catalogItemId: statusItemId,
                    isActive: true
                },
                include: [{
                    model: CatalogType,
                    as: 'catalogType',
                    where: { code: USER_STATUS_CATALOG_CODE },
                    attributes: []
                }],
                transaction
            });
            if( !status ) {
                throw new AppError(getMessage('user.statusNotFound', lang), 404, 'USER_001_STATUS_NOT_FOUND');
            }
        }
        // Role existence check
        const roleIds = Array.isArray( roleId ) ? roleId : [ roleId ];
        const roles = await AppRole.findAll({
            where: {
                roleId: roleIds,
                isActive: true
            },
            transaction
        });
        if( roles.length !== roleIds.length ) {
            throw new AppError(getMessage('role.notFound', lang), 404, 'USER_001_ROLE_NOT_FOUND');
        }
        // Escalation guard: an ADMIN creates users up to its own level, never above it.
        // Without it, lowering this route to ADMIN would turn it into a trivial escalation path
        const highestRequestedLevel = Math.max(0, ...roles.map(role => role.level ?? 0));
        if( highestRequestedLevel > requesterLevel(authUser) ) {
            throw new AppError(getMessage('user.roleLevelExceeded', lang), 403, 'USER_001_ROLE_LEVEL_EXCEEDED');
        }
        // User creation
        const passwordHash = await bcrypt.hash( password, 10 );
        const userEntry: AppDetails = {
            createdAt: new Date(),
            user: creatorId || 'undefined',
            method: 'ESAVI-USER-001',
            detail: 'User created by service'
        };
        const user = await AppUser.create({
            username: normalizedUsername ? esaviCrypt(normalizedUsername) : undefined,
            firstName: esaviCrypt(normalizedFirstName),
            lastName: esaviCrypt(normalizedLastName),
            email: esaviCrypt(normalizedEmail),
            displayName: esaviCrypt(`${normalizedFirstName} ${normalizedLastName}`),
            phone: phone ?? undefined,
            statusItemId: statusItemId ?? null,
            passwordHash: passwordHash,
            requiresPasswordChange: true,
            isActive: true,
            appDetails: [userEntry]
        }, { transaction });

        // User-Role association
        await Promise.all(
            roleIds.map((roleId) => {
                const roleEntry: AppDetails = {
                    createdAt: new Date(),
                    user: creatorId || 'undefined',
                    method: 'ESAVI-USER-001',
                    detail: 'Role assigned by service'
                };
                return AppUserRole.create({
                    userId: user.userId,
                    roleId,
                    assignedByUserId: creatorId,
                    appDetails: [roleEntry]
                }, { transaction });
            })
        );

        await transaction.commit();
        const userWithRoles = await AppUser.findOne({
            where: {
                userId: user.userId
            },
            attributes: LIST_EXCLUDE,
            include: [ROLES_INCLUDE, STATUS_INCLUDE]
        });

        return userWithRoles ? toUserResponse(userWithRoles) : null;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Get Active Users Service
// Code: ESAVI-USER-002A
const getUsersService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    // distinct keeps the count on users, not on the rows the roles join multiplies
    const { count, rows } = await AppUser.findAndCountAll({
        where: { isActive: true },
        attributes: LIST_EXCLUDE,
        include: [ROLES_INCLUDE, STATUS_INCLUDE],
        distinct: true,
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toUserListRow) };
}

// Get All Users Service - For Admin
// Code: ESAVI-USER-002B
const getAllUsersService = async (limit: number = DEFAULT_LIMIT, offset: number = DEFAULT_OFFSET) => {
    const { count, rows } = await AppUser.findAndCountAll({
        attributes: LIST_EXCLUDE,
        include: [ROLES_INCLUDE, STATUS_INCLUDE],
        distinct: true,
        order: LIST_ORDER,
        limit,
        offset
    });
    return { count, rows: rows.map(toUserListRow) };
}

// The read 003 and 007 share. Each one raises its own 404 so the operation code stays
// the same in the five places the convention requires
const findUserWithRelations = async (id: string, includeInactive: boolean = false) => {
    const where = includeInactive ? { userId: id } : { userId: id, isActive: true };
    return await AppUser.findOne({
        where,
        attributes: LIST_EXCLUDE,
        include: [ROLES_INCLUDE, STATUS_INCLUDE]
    });
}

// Get User By ID Service
// Code: ESAVI-USER-003
const getUserByIdService = async (id: string, lang: string, canViewInactive: boolean = false) => {
    const user = await findUserWithRelations(id, canViewInactive);
    if( !user ) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USER_003_NOT_FOUND');
    }
    return toUserResponse(user);
}

// Get Own Profile Service
// Code: ESAVI-USER-007
const getOwnProfileService = async (authUser: AuthUser | undefined, lang: string) => {
    // tokenValidation only attaches active users, so the inactive branch is unreachable here
    const user = authUser?.userId ? await findUserWithRelations(authUser.userId) : null;
    if( !user ) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USER_007_NOT_FOUND');
    }
    return toUserResponse(user);
}

// Update User Service
// Code: ESAVI-USER-004
// password and roleId are ignored on purpose: the first belongs to 006, the second to the
// appUserRole endpoints. The validator already rejects both, this is the second line
const updateUserService = async (id: string, data: Partial<CreateUserInput>, authUser: AuthUser | undefined, lang: string) => {
    const { userId } = authUser || {};
    const { username, email, firstName, lastName, phone, statusItemId } = data;
    const user = await AppUser.findByPk(id);
    if( !user ) {
        throw new AppError(getMessage('user.notFound', lang), 404, 'USER_004_NOT_FOUND');
    }
    // Uniqueness does not filter by isActive — that is what the UNIQUE constraints guarantee —
    // and it excludes the record being updated
    const targetEmail = email ? esaviCrypt(normalizeEmail(email)) : undefined;
    if( targetEmail && targetEmail !== user.email ) {
        const existingEmail = await AppUser.findOne({
            where: {
                email: targetEmail,
                userId: { [Op.ne]: id }
            }
        });
        if( existingEmail ) {
            throw new AppError(getMessage('user.alreadyExists', lang), 409, 'USER_004_EMAIL_EXISTS');
        }
    }
    const normalizedUsername = username?.trim();
    const targetUsername = normalizedUsername ? esaviCrypt(normalizedUsername) : undefined;
    if( targetUsername && targetUsername !== user.username ) {
        const existingUsername = await AppUser.findOne({
            where: {
                username: targetUsername,
                userId: { [Op.ne]: id }
            }
        });
        if( existingUsername ) {
            throw new AppError(getMessage('user.usernameExists', lang, { username: normalizedUsername }), 409, 'USER_004_USERNAME_EXISTS');
        }
    }
    // Validate that the referenced CatalogItem for user status exists, is active and
    // belongs to the userStatus catalog
    if( statusItemId && statusItemId !== user.statusItemId ) {
        const status = await CatalogItem.findOne({
            where: {
                catalogItemId: statusItemId,
                isActive: true
            },
            include: [{
                model: CatalogType,
                as: 'catalogType',
                where: { code: USER_STATUS_CATALOG_CODE },
                attributes: []
            }]
        });
        if( !status ) {
            throw new AppError(getMessage('user.statusNotFound', lang), 404, 'USER_004_STATUS_NOT_FOUND');
        }
    }
    const targetFirstName = firstName ? esaviCrypt(toTitleCase(firstName.trim())) : undefined;
    const targetLastName = lastName ? esaviCrypt(toTitleCase(lastName.trim())) : undefined;
    const currentAppDetails = Array.isArray(user.appDetails) ? user.appDetails : [];
    const objectToUpdate: Record<string, unknown> = {
        username: targetUsername && targetUsername !== user.username ? targetUsername : undefined,
        email: targetEmail && targetEmail !== user.email ? targetEmail : undefined,
        firstName: targetFirstName && targetFirstName !== user.firstName ? targetFirstName : undefined,
        lastName: targetLastName && targetLastName !== user.lastName ? targetLastName : undefined,
        phone: phone && phone.trim() !== user.phone ? phone.trim() : undefined,
        statusItemId: statusItemId && statusItemId !== user.statusItemId ? statusItemId : undefined
    };
    for( const key of Object.keys(objectToUpdate) ) {
        if( objectToUpdate[key] === undefined ) delete objectToUpdate[key];
    }
    // displayName is never received: it is recomposed from whichever of the two names changed,
    // over the value already stored for the one that did not
    if( objectToUpdate.firstName !== undefined || objectToUpdate.lastName !== undefined ) {
        const nextFirstName = esaviDecrypt((objectToUpdate.firstName as string) ?? user.firstName as string);
        const nextLastName = esaviDecrypt((objectToUpdate.lastName as string) ?? user.lastName as string);
        objectToUpdate.displayName = esaviCrypt(`${nextFirstName} ${nextLastName}`);
    }
    // The entry is written even when nothing changed: the attempt is part of the audit trail
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: userId || 'undefined',
        method: 'ESAVI-USER-004',
        detail: 'User updated by service'
    };
    await user.update({
        ...objectToUpdate,
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });
    const updatedUser = await findUserWithRelations(id, true);
    return updatedUser ? toUserResponse(updatedUser) : null;
}

export {
    createUserService,
    getUsersService,
    getAllUsersService,
    getUserByIdService,
    getOwnProfileService,
    updateUserService
};
