import { AuthUser } from '../types';
import { ROLES } from '../constants/roles.constants';

const SUPERADMIN = ROLES.SUPERADMIN;
const ADMIN = ROLES.ADMIN;
const ANALYTICS = ROLES.ANALYTICS;

const hasAnyRole = ( authUser: AuthUser | undefined, requiredRoles: string[] ): boolean => {
    if( !authUser || !authUser.roles ) return false;
    return authUser.roles.some(role => requiredRoles.includes(role.name));
};

// Is superadmin
const isSuperAdmin = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN]);
}

// Is admin
const isAdmin = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN, ADMIN]);
}

// View inactive records
const canViewInactive = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN]);
};

// Manage users and roles
const canManageUsers = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN, ADMIN]);
};

// Can import geographical data
const canImportGeographicalData = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN]);
}

//Can view dahsboards and analytics
const canViewDashboards = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN, ADMIN, ANALYTICS]);
}

// Can delete locations
const canDeleteLocations = ( authUser?: AuthUser ): boolean => {
    return hasAnyRole(authUser, [SUPERADMIN]);
}

export {
    canViewInactive,
    canManageUsers,
    canImportGeographicalData,
    canViewDashboards,
    canDeleteLocations,
    isSuperAdmin,
    isAdmin
}