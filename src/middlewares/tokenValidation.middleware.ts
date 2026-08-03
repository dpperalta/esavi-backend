import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { getMessage } from '../helpers/i18n.helper';

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

const tokenValidation = async( req: Request, res: Response, next: NextFunction ): Promise<void | Response> => {
    try {
        const authHeader = req.headers.authorization;
        if( !authHeader || !authHeader.startsWith('Bearer ') ) {
            return res.status(401).json({
                ok: false,
                message: getMessage('auth.tokenMissing', req.lang)
            });
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
                through: { attributes: [] }
            }
        ]
    });
        if ( !user ) {
            return res.status(401).json({
                ok: false,
                message: getMessage('auth.userNotFound', req.lang)
            });
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
        esaviLog('ESAVI-ERROR - Error during token validation', 'error');
        if ( error instanceof jwt.TokenExpiredError ) {
            return res.status(401).json({
                ok: false,
                message: getMessage('auth.tokenExpired', req.lang),
                error: error instanceof Error ? error.message : 'Expired token error'
            });
        } else if ( error instanceof jwt.JsonWebTokenError ) {
            return res.status(401).json({
                ok: false,
                message: getMessage('auth.invalidToken', req.lang),
                error: error instanceof Error ? error.message : 'Invalid token error'
            });
        } else {
            return res.status(500).json({
                ok: false,
                message: 'Internal server error',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}

export {
    tokenValidation
}