import { Request, Response, NextFunction } from 'express';
import { getMessage } from '../helpers/i18n.helper';
import { AppError } from '../helpers/appError.helper';
import { ROLE_LEVELS } from '../constants/roles.constants';

const validateUserRole = ( ...requiredRole: string[] ) => {
    return ( req: Request, _res: Response, next: NextFunction ): void => {
        const userRoles = req.user?.roles || [];
        const requiredMinLevel = Math.max(
            ...requiredRole.map(role => ROLE_LEVELS[role] || 0)
        );
        // The requester's level comes from the appRole.level column that tokenValidation already
        // reloads on every request, so a role created through the API authorizes for real.
        // ROLE_LEVELS stays as the fallback for a null level in the database, which is what keeps
        // the change from locking anyone out of an existing deployment.
        // The REQUIRED level above is a route literal and still comes from the constant.
        const userMaxRoleLevel = Math.max(
            0,
            ...userRoles.map(role => {
                const roleName = role.name.toUpperCase();
                return role.level ?? ROLE_LEVELS[roleName] ?? 0;
            }),
        );
        if ( userMaxRoleLevel < requiredMinLevel ) {
            // Rejected through errorHandler so the 403 carries `code` like every other error of
            // the API: a client that only reads the message cannot distinguish an insufficient
            // role from an expired session. CONVENTIONS.md §10 — Error
            next(new AppError(getMessage('auth.forbidden', req.lang), 403, 'AUTH_ROLE_FORBIDDEN'));
            return;
        }
        next();
    }
};

export {
    validateUserRole
}
