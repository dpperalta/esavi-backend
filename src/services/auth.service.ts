import bcrypt from 'bcrypt';
import net from 'net';

import { AppUser } from '../models/appUser.model';
import { AppRole } from '../models/appRole.model';

import { getMessage } from '../helpers/i18n.helper';
import { esaviCrypt, esaviDecrypt } from '../helpers/crypto.helper';
import { AppError } from '../helpers/appError.helper';
import { createAppSessionService } from './appSession.service';
import { LoginOutput } from '../types';

interface LoginInput {
    email: string;
    password: string;
}

/**
 * Where the request came from. Trace only: SPEC F42 §2 leaves both fields out of the refresh
 * checks, because a User-Agent changes with every browser update and an IP changes when the
 * device hops networks. Validating them would close legitimate sessions daily in exchange for a
 * barrier an attacker holding the token copies for free.
 */
interface LoginRequestMeta {
    ipAddress?: string | null;
    userAgent?: string | null;
}

// `userAgent` is text in the DDL, so the cap is ours: a header is client-controlled and unbounded
const USER_AGENT_MAX_LENGTH = 512;

// The column is `inet`, and Postgres rejects anything that is not an address — which would turn a
// trace field into a failed login. Anything unparseable is dropped instead of written
const toInetOrNull = ( value?: string | null ): string | null =>
    ( typeof value === 'string' && net.isIP( value ) !== 0 ) ? value : null;

const toUserAgentOrNull = ( value?: string | null ): string | null =>
    typeof value === 'string' && value.length > 0 ? value.slice( 0, USER_AGENT_MAX_LENGTH ) : null;

// ESAVI-AUTH-001 - Login Service
// Everything up to the password check is what this service has always done. What SPEC F42 adds is
// the tail: the login now opens a row in `appSession` and hands back a refresh token next to the
// access token. The change is additive — no field of the previous response disappears or changes type
const loginService = async({ email, password }: LoginInput, lang: string, meta: LoginRequestMeta = {}): Promise<LoginOutput> => {
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

    // ESAVI-SESSION-001 mints both credentials at once: it is the only place the refresh token
    // exists in clear text, and it also signs the access token so the JWT is issued in one place
    const { token, refreshToken, expiresAt } = await createAppSessionService({
        userId: user.getDataValue('userId'),
        ipAddress: toInetOrNull( meta.ipAddress ),
        userAgent: toUserAgentOrNull( meta.userAgent )
    }, lang);

    return {
        token,
        refreshToken,
        expiresAt,
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