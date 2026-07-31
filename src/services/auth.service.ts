import bcrypt from 'bcrypt';

import { AppUser } from '../models/appUser.model';
import { AppRole } from '../models/appRole.model';

import { getMessage } from '../helpers/i18n.helper';
import { jwtGenerate } from '../helpers/jwt.helper';
import { esaviCrypt, esaviDecrypt } from '../helpers/crypto.helper';
import { AppError } from '../helpers/appError.helper';

interface LoginInput {
    email: string;
    password: string;
}

// ESAVI-AUTH-001 - Login Service
const loginService =async({ email, password }: LoginInput) => {
    const user = await AppUser.findOne({
        where: {
            email: esaviCrypt(email),
            isActive: true
        },
        include: [
            {
                model: AppRole,
                as: 'roles',
                through: { attributes: [] }
            }
        ]
    });
    if( !user ) {
        throw new AppError(getMessage('auth.invalidCredentials'), 404, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if( !isPasswordValid ) {
        throw new AppError(getMessage('auth.invalidCredentials'), 404, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const roles = user.roles?.map((role: AppRole) => ({
        roleId: role.getDataValue('roleId'),
        name: role.getDataValue('name'),
        code: role.getDataValue('code')
    })) ?? [];

    const token = await jwtGenerate({
        userId: user.getDataValue('userId'),
        //email: user.getDataValue('email'),
        //displayName: user.getDataValue('displayName'),
        //roles
    });
    
    return {
        token,
        user: {
            userId: user.userId,
            email: esaviDecrypt(user.email),
            //email: user.getDataValue('email'),
            displayName: esaviDecrypt(user.displayName),
            //displayName: user.getDataValue('displayName'),
            roles
        }
    };  
};

export {
    loginService
}