export interface CreateAppUserRoleInput {
    userId: string;
    roleId: string;
}

export interface BulkAssignRolesInput {
    userId: string;
    roleIds: string[];
}
