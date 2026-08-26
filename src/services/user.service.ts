import bcrypt from 'bcrypt';
import { Op, Transaction } from 'sequelize';
import { sequelize } from '../database/connection';
import { AppRole, AppUser, AppUserRole } from '../models';
import { AppDetails, AuthUser, ChangePasswordInput, CreateUserInput, CreateUserServiceParams } from '../types';
import { AppError, buildDifferentialUpdate, esaviCrypt, esaviDecrypt, getMessage, toTitleCase } from '../helpers';
import { DEFAULT_LIMIT, DEFAULT_OFFSET } from '../constants/pagination.constants';
import { ROLES } from '../constants/roles.constants';
import { setEntityActiveStatusService } from './common/entityActivation.service';
import { revokeAllUserSessionsService } from './appSession.service';

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

// passwordHash and sysDetails never leave the service
const LIST_EXCLUDE = { exclude: ['passwordHash', 'sysDetails'] };

// A user list is read newest first. Alphabetical is impossible: the names are encrypted and
// ORDER BY would sort by the ciphertext
const LIST_ORDER: [string, string][] = [['createdAt', 'DESC']];

// The five encrypted columns, named once: the responses decrypt them and ESAVI-USER-004
// compares them over plain text
const PII_FIELDS = ['username', 'email', 'displayName', 'firstName', 'lastName'];

const decryptPii = (plain: Record<string, unknown>) => {
    for (const field of PII_FIELDS) {
        const value = plain[field];
        plain[field] = typeof value === 'string' ? esaviDecrypt(value) : null;
    }
    return plain;
}

// sysDetails is trigger metadata and passwordHash never leaves the service. The five
// encrypted columns are returned in clear text
const toUserResponse = (user: AppUser) => {
    const plain = user.toJSON() as Record<string, unknown>;
    delete plain.sysDetails;
    delete plain.passwordHash;
    return decryptPii(plain);
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
    const { email, password, username, firstName, lastName, phone, roleId } = data;
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
            include: [ROLES_INCLUDE]
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
        include: [ROLES_INCLUDE],
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
        include: [ROLES_INCLUDE],
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
        include: [ROLES_INCLUDE]
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
    const { username, email, firstName, lastName, phone } = data;
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
    const currentAppDetails = Array.isArray(user.appDetails) ? user.appDetails : [];
    // Differential update: only what really changed reaches the UPDATE. Until now the five
    // fields were compared as ciphertext and the UPDATE ran anyway, so every PUT re-encrypted
    // and rewrote them with their own value. `stored` is the whole row, which is the
    // precondition of the helper, with the five encrypted columns decrypted: comparing
    // ciphertext only works because esaviCrypt has a fixed IV, and moving to a random one would
    // break the comparison in silence — everything would count as a change — with no test
    // telling it apart from a legitimate one. esaviCrypt is applied after the diff
    const stored = decryptPii(user.get({ plain: true }) as Record<string, unknown>);
    // displayName is never received: it is recomposed from the resulting first and last name,
    // over the stored value of whichever did not arrive. Derived, so it travels always and the
    // helper is the one that decides whether it changed
    const nextFirstName = firstName ? toTitleCase(firstName.trim()) : stored.firstName as string;
    const nextLastName = lastName ? toTitleCase(lastName.trim()) : stored.lastName as string;
    const changes = buildDifferentialUpdate(stored, {
        username: normalizedUsername ? normalizedUsername : undefined,
        email: email ? normalizeEmail(email) : undefined,
        firstName: firstName ? nextFirstName : undefined,
        lastName: lastName ? nextLastName : undefined,
        phone: phone ? phone.trim() : undefined,
        displayName: nextFirstName && nextLastName ? `${ nextFirstName } ${ nextLastName }` : undefined
    });

    // Nothing changed: no UPDATE, no updatedAt and no audit entry. The record is returned as it
    // stands, which is the state the client asked for
    if( Object.keys(changes).length === 0 ) {
        const unchanged = await findUserWithRelations(id, true);
        return unchanged ? toUserResponse(unchanged) : null;
    }

    const objectToUpdate: Record<string, unknown> = { ...changes };
    for( const field of PII_FIELDS ) {
        if( objectToUpdate[field] ) {
            objectToUpdate[field] = esaviCrypt(objectToUpdate[field] as string);
        }
    }

    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: userId || 'undefined',
        method: 'ESAVI-USER-004',
        detail: 'User updated by service'
    };
    await user.update({
        ...objectToUpdate,
        updatedAt: new Date(),
        appDetails: [
            ...currentAppDetails,
            newEntry
        ]
    });
    const updatedUser = await findUserWithRelations(id, true);
    return updatedUser ? toUserResponse(updatedUser) : null;
}

// Users who currently carry the SUPERADMIN role: the assignment is active and so is the user.
// Sibling of the guard SPEC F02 applies to the last assignment — there the assignment is
// protected, here the last carrier
const activeSuperAdminIds = async (transaction: Transaction): Promise<Set<string>> => {
    const superAdminRole = await AppRole.findOne({
        where: { name: ROLES.SUPERADMIN, isActive: true },
        transaction
    });
    if( !superAdminRole ) return new Set();
    const assignments = await AppUserRole.findAll({
        where: { roleId: superAdminRole.roleId, isActive: true },
        attributes: ['userId'],
        include: [{
            model: AppUser,
            as: 'user',
            where: { isActive: true },
            attributes: []
        }],
        transaction
    });
    return new Set(assignments.map(assignment => assignment.userId));
}

// Setting User Active/Inactive Service
// Code: ESAVI-USER-005A / ESAVI-USER-005B
const setUserActivationService = async (id: string, authUser: AuthUser | undefined, lang: string, isActive: boolean = true) => {
    const op = isActive ? '005B' : '005A';
    const transaction = await sequelize.transaction();
    try {
        if( !isActive ) {
            // Nobody closes the door from the inside: 005B requires SUPERADMIN, so an
            // administrator who deactivates themselves cannot undo it
            if( id === authUser?.userId ) {
                throw new AppError(getMessage('user.selfDeactivation', lang), 409, 'USER_005A_SELF_DEACTIVATION');
            }
            // The check and the write share the transaction the service already opens
            const superAdminIds = await activeSuperAdminIds(transaction);
            if( superAdminIds.has(id) && superAdminIds.size <= 1 ) {
                throw new AppError(getMessage('user.lastSuperAdmin', lang), 409, 'USER_005A_LAST_SUPERADMIN');
            }
        } else {
            // The unique constraints do not filter by isActive, so reactivating cannot collide
            // today. Checked anyway: the guard is what keeps a 409 from turning into a 23505
            const user = await AppUser.findByPk(id, { transaction });
            if( user ) {
                const takenEmail = await AppUser.findOne({
                    where: {
                        email: user.email,
                        userId: { [Op.ne]: id },
                        isActive: true
                    },
                    transaction
                });
                if( takenEmail ) {
                    throw new AppError(getMessage('user.alreadyExists', lang), 409, 'USER_005B_EMAIL_EXISTS');
                }
                if( user.username ) {
                    const takenUsername = await AppUser.findOne({
                        where: {
                            username: user.username,
                            userId: { [Op.ne]: id },
                            isActive: true
                        },
                        transaction
                    });
                    if( takenUsername ) {
                        throw new AppError(getMessage('user.usernameExists', lang, { username: esaviDecrypt(user.username) }), 409, 'USER_005B_USERNAME_EXISTS');
                    }
                }
            }
        }
        await setEntityActiveStatusService({
            model: AppUser,
            where: { userId: id },
            isActive,
            transaction,
            notFoundMessage: getMessage('user.notFound', lang),
            notFoundCode: `USER_${ op }_NOT_FOUND`,
            alreadyInStateMessage: getMessage(`user.${ isActive ? 'alreadyActive' : 'alreadyInactive' }`, lang, { id }),
            alreadyInStateCode: `USER_${ op }_` + ( isActive ? 'ALREADY_ACTIVE' : 'ALREADY_INACTIVE' ),
            appDetail: {
                createdAt: new Date(),
                user: authUser?.userId || 'undefined',
                method: `ESAVI-USER-${ op }`,
                detail: `User ${ isActive ? 'activated' : 'deactivated' } by service`
            }
        });
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

// Change Own Password Service
// Code: ESAVI-USER-006
// Always acts on the token holder: no user identifier is accepted, not even from a SUPERADMIN.
// A successful change now closes every session of the user (SPEC F42): the row update and the
// revocation share one transaction, because a password changed with surviving sessions is worse
// than a change that failed. The access token in flight still runs until it expires — up to
// JWT_EXPIRES_IN — but its refresh token is dead, so the session cannot outlive that window
const changePasswordService = async (authUser: AuthUser | undefined, data: ChangePasswordInput, lang: string) => {
    const { currentPassword, newPassword } = data;
    const user = authUser?.userId
        ? await AppUser.findOne({ where: { userId: authUser.userId, isActive: true } })
        : null;
    if( !user ) {
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'USER_006_INVALID_CREDENTIALS');
    }
    // Verifying the current password is what keeps a stolen token from taking the account over
    // permanently in a single request. 401 and not 403: §10 attributes it to invalid credentials
    const isPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if( !isPasswordValid ) {
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'USER_006_INVALID_CREDENTIALS');
    }
    // A password change that changes nothing would clear requiresPasswordChange while the
    // imposed password stays in use
    if( newPassword === currentPassword ) {
        throw new AppError(getMessage('user.samePassword', lang), 409, 'USER_006_SAME_PASSWORD');
    }
    const currentAppDetails = Array.isArray(user.appDetails) ? user.appDetails : [];
    const newEntry: AppDetails = {
        createdAt: new Date(),
        user: authUser?.userId || 'undefined',
        method: 'ESAVI-USER-006',
        detail: 'Password changed by service'
    };
    // The transaction opens here and not at the top of the service on purpose: everything above is
    // reads and guards that throw before any write. What must be atomic is the pair below
    const transaction = await sequelize.transaction();
    try {
        await user.update({
            passwordHash: await bcrypt.hash(newPassword, 10),
            requiresPasswordChange: false,
            appDetails: [
                ...currentAppDetails,
                newEntry
            ]
        }, { transaction });
        // ESAVI-SESSION-007. The trigger is the effective write above, never the presence of
        // `newPassword` in the body: a change that never reached the update — wrong current
        // password, missing user — revokes nothing, because it threw before getting here
        await revokeAllUserSessionsService(user.userId, 'PASSWORD_CHANGED', lang, transaction);
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export {
    createUserService,
    getUsersService,
    getAllUsersService,
    getUserByIdService,
    getOwnProfileService,
    updateUserService,
    setUserActivationService,
    changePasswordService
};
