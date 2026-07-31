export const ROLES = {
    SUPERADMIN: process.env.ROLE_SUPERADMIN || 'SUPERADMIN',
    ADMIN: process.env.ROLE_ADMIN || 'ADMIN',
    USER: process.env.ROLE_USER || 'USER',
    ANALYTICS: process.env.ROLE_ANALYTICS || 'ANALYTICS',
} as const;

export const ROLE_LEVELS = {
    [ROLES.SUPERADMIN]: 100,
    [ROLES.ADMIN]: 50,
    [ROLES.USER]: 25,
    [ROLES.ANALYTICS]: 10,
} as const;