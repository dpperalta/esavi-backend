export interface CreateUserInput {
    username?: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string | null;
    statusItemId?: string | null;
    roleId: string | string[];
}

export interface ChangePasswordInput {
    currentPassword: string;
    newPassword: string;
}

export interface UserRole {
    name: string;
    level: number;
    roleId?: string;   // el token no lo puebla
    code?: string;     // el token no lo puebla
}

export interface AuthUser {
    userId: string;
    email: string;
    displayName: string;
    roles: UserRole[];
}

export interface CreateUserServiceParams {
    data: CreateUserInput;
    authUser?: AuthUser;
    lang: string;
}

