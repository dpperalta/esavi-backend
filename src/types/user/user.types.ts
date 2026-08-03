export interface CreateUserInput {
    username?: string;
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    roleId: string | string[];
}

export interface UserRole {
    roleId: string;
    name: string;
    code: string;
    level: number;
}

export interface AuthUser {
    userId: string;
    email: string;
    displayName: string;
    roles: UserRole[];
}

export interface CreateUserServiceParams {
    data: CreateUserInput;
    authUser: AuthUser;
    lang?: string;
}

