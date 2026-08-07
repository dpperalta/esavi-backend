import { Request, Response, NextFunction } from 'express';
import { getMessage } from '../helpers/i18n.helper';
import { ROLE_LEVELS } from '../constants/roles.constants';

const validateUserRole = ( ...requiredRole: string[] ) => {
    return ( req: Request, res: Response, next: NextFunction ): Response | void => {
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
            return res.status(403).json({
                ok: false,
                message: getMessage('auth.forbidden', req.lang),
                error: `Forbidden: Requires elevation`
            });
        }
        next();
    }
};

export {
    validateUserRole
}