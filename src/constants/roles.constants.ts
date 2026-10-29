export const ROLES = {
    SUPERADMIN: 'SUPERADMIN',
    ADMIN: 'ADMIN',
    USER: 'USER',
    ANALYTICS: 'ANALYTICS',
} as const;

export const ROLE_LEVELS: Readonly<Record<string, number>> = {
    [ROLES.SUPERADMIN]: 100,
    [ROLES.ADMIN]: 50,
    [ROLES.USER]: 25,
    [ROLES.ANALYTICS]: 10,
};
