import { AuthUser } from '../types';
import { ROLE_LEVELS } from '../constants/roles.constants';

const getUserRoleLevel = ( authUser?: AuthUser ): number => {
    const roles = authUser?.roles || [];
    return Math.max(
        0,
        ...roles.map(role => role.level ?? ROLE_LEVELS[role.name.toUpperCase()] ?? 0),
    );
};

export {
    getUserRoleLevel
}
