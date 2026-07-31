import bcrypt from 'bcrypt';
import { sequelize } from '../database/connection'; 
import { AppUser }  from '../models/appUser.model';
import { AppRole }  from '../models/appRole.model';
import { AppUserRole } from '../models/appUserRole.model';
import { CreateUserServiceParams } from '../types';
import { getMessage } from '../helpers/i18n.helper';
import { esaviCrypt } from '../helpers/crypto.helper';
import { AppError } from '../helpers/appError.helper';

// ESAVI-USER-001 - Create User Service
const createUserService = async ({data, authUser, lang = 'en'}: CreateUserServiceParams) => {
    const transaction = await sequelize.transaction();
    const { email, password, username, firstName, lastName, roleId } = data;
    const { userId: creatorId } = authUser || {};
    try {
        // User existence check
        const existingUser = await AppUser.findOne({
            where: {
                email: esaviCrypt(email),
                isActive: true
            },
            transaction
        }); 
        if( existingUser ) {
            throw new AppError(getMessage('user.alreadyExists', lang), 409, 'USER_001_ALREADY_EXISTS');
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
        // User creation
        const passwordHash = await bcrypt.hash( password, 10 );
        const user = await AppUser.create({
            username: username ? esaviCrypt(username) : undefined,
            firstName: esaviCrypt(firstName),
            lastName: esaviCrypt(lastName),
            email: esaviCrypt(email),
            displayName: esaviCrypt(`${firstName} ${lastName}`),
            passwordHash: passwordHash,
            requiresPasswordChange: true,
            isActive: true,
            appDetails: [{
                'createdAt': new Date(),
                'user': creatorId || 'undefined',
                'method': 'ESAVI-USER-001',
                'detail': 'User created by service'
            }]
        }, { transaction });

        // User-Role association
        await Promise.all(
            roleIds.map((roleId) => 
                AppUserRole.create({
                    userId: user.userId,
                    roleId,
                    assignedByUserId: creatorId,
                    appDetails: [{
                        'createdAt': new Date(),
                        'user': creatorId || 'undefined',
                        'method': 'ESAVI-USER-001',
                        'detail': 'Role assigned by service'
                    }]
                }, { transaction }) 
            )
        );
        
        await transaction.commit();
        const userWithRoles = await AppUser.findOne({
            where: {
                userId: user.userId
            },
            attributes: { exclude: ['passwordHash'] },
            include: [
                {
                    model: AppRole,
                    as: 'roles',
                    through: { attributes: [] },
                    attributes: ['roleId', 'name', 'code']
                }
            ]
        });

        return userWithRoles;
    } catch (error) {
        await transaction.rollback();
        throw error;
    }
}

export { createUserService };