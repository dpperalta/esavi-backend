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
const loginService =async({ email, password }: LoginInput, lang: string) => {
    // Normalized exactly like the creation does. citext does not help here: the column stores
    // the ciphertext, so Postgres case insensitivity applies to the encrypted text and not to
    // the address. Without this, a login typed in uppercase produces a different ciphertext
    const normalizedEmail = email.trim().toLowerCase();
    const user = await AppUser.findOne({
        where: {
            email: esaviCrypt(normalizedEmail),
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
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if( !isPasswordValid ) {
        throw new AppError(getMessage('auth.invalidCredentials', lang), 401, 'AUTH_001_INVALID_CREDENTIALS');
    }
    const roles = user.roles?.map((role: AppRole) => ({
        roleId: role.getDataValue('roleId'),
        name: role.getDataValue('name'),
        code: role.getDataValue('code')
    })) ?? [];

    const token = await jwtGenerate({
        userId: user.getDataValue('userId'),
    });
    
    return {
        token,
        user: {
            userId: user.userId,
            email: esaviDecrypt(user.email),
            displayName: esaviDecrypt(user.displayName),
            roles
        }
    };  
};

export {
    loginService
}