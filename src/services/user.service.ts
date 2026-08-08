import bcrypt from 'bcrypt';
import { sequelize } from '../database/connection';
import { AppRole, AppUser, AppUserRole, CatalogItem, CatalogType } from '../models';
import { AppDetails, AuthUser, CreateUserServiceParams } from '../types';
import { AppError, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';

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
            attributes: { exclude: ['passwordHash'] },
            include: [
                ROLES_INCLUDE,
                {
                    model: CatalogItem,
                    as: 'status',
                    attributes: ['catalogItemId', 'code', 'name']
                }
            ]
        });

        return userWithRoles ? toUserResponse(userWithRoles) : null;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export { createUserService };
