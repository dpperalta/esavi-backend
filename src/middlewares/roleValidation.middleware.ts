import { Request, Response, NextFunction } from 'express';
import { getMessage } from '../helpers/i18n.helper';
import { ROLE_LEVELS } from '../constants/roles.constants';

/* const validateUserRole = ( ...requiredRole: string[] ) => {
    return ( req: Request, res: Response, next: NextFunction ): Response | void => {
        const userRoles = req.user?.roles || [];
        const hasRequiredRole = userRoles.some(
            role => requiredRole.includes(role.name)
        );
        if (!hasRequiredRole) {
            return res.status(403).json({
                ok: false,
                message: getMessage('auth.forbidden', req.lang),
                error: `Forbidden: Requires elevation`
            });
        }
        next();
    }
} */
const validateUserRole = ( ...requiredRole: string[] ) => {
    return ( req: Request, res: Response, next: NextFunction ): Response | void => {
        const userRoles = req.user?.roles || [];
        const requiredMinLevel = Math.max(
            ...requiredRole.map(role => ROLE_LEVELS[role] || 0)
        );
        const userMaxRoleLevel = Math.max(
            0, 
            ...userRoles.map(role => {
                const roleName = role.name.toUpperCase();
                return ROLE_LEVELS[roleName] || 0;
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