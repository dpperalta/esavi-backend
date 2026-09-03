import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { getMessage } from '../helpers/i18n.helper';

import { AppError } from '../helpers/appError.helper';
import { esaviLog } from '../helpers/esaviLogs.helper';
import { AppUser } from '../models';
import { AppRole } from '../models/appRole.model';

interface TokenPayload {
    user: {
        userId: string;
        email?: string;
        displayName?: string;
        roles?: Array<{
            roleId: string;
            name: string;
            code: string;
        }>;
    },
    iat: number;
    exp: number;
}

/**
 * Every rejection travels as an `AppError` through `next()`, never as a hand-built
 * `res.status(...).json({ ok: false })`. That is what puts `code` in the body: the four ways
 * authentication fails look identical to the client without it, and the frontend cannot tell
 * "log in again" from "your session expired" from a plain 401 with only a translated message.
 * CONVENTIONS.md §10 — Error.
 */
const tokenValidation = async( req: Request, _res: Response, next: NextFunction ): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        if( !authHeader || !authHeader.startsWith('Bearer ') ) {
            next(new AppError(getMessage('auth.tokenMissing', req.lang), 401, 'AUTH_TOKEN_MISSING'));
            return;
        }
        const token = authHeader.split(' ')[1];
        const jwtSecret = process.env.JWT_SECRET as string;
        const decoded = jwt.verify(token, jwtSecret) as TokenPayload;
        const userId = decoded.user.userId;
        // Getting user data from token and attaching it to the request object for further use in controllers
        const user = await AppUser.findOne({
        where: {
            userId,
            isActive: true
        },
        include: [
            {
                model: AppRole,
                as: 'roles',
                // A revoked assignment must stop authorizing on the next request, and a role
                // deactivated system-wide must stop authorizing without revoking it user by user.
                // validTo is deliberately not filtered: isActive governs the state of an assignment
                where: { isActive: true },
                required: false,
                through: {
                    attributes: [],
                    where: { isActive: true, deletedAt: null }
                }
            }
        ]
    });
        if ( !user ) {
            next(new AppError(getMessage('auth.userNotFound', req.lang), 401, 'AUTH_USER_NOT_FOUND'));
            return;
        }
        // Mapping roles to the format defined in the token payload
        const roles = user.roles?.map((role: AppRole) => ({
                name: role.getDataValue('name'),
                level: role.getDataValue('level')
            })) ?? [];
        const userHeader = {
            userId: user.getDataValue('userId'),
            email: user.getDataValue('email'),
            displayName: user.getDataValue('displayName'),
            roles: roles 
        }
        // Assigning user data to request object for use in controllers
        req.user = userHeader;
        next();
    } catch (error) {
        esaviLog('ESAVI-ERROR - Error during token validation: ' + error, 'error');
        if ( error instanceof jwt.TokenExpiredError ) {
            next(new AppError(getMessage('auth.tokenExpired', req.lang), 401, 'AUTH_TOKEN_EXPIRED', error));
            return;
        }
        if ( error instanceof jwt.JsonWebTokenError ) {
            next(new AppError(getMessage('auth.invalidToken', req.lang), 401, 'AUTH_TOKEN_INVALID', error));
            return;
        }
        next(new AppError(getMessage('common.internalError', req.lang), 500, 'AUTH_TOKEN_VALIDATION_FAILED', error));
    }
}

export {
    tokenValidation
}
