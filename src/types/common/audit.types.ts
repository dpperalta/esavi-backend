export interface SysDetails {
    version?: number;
    createdBy: string;
    updatedBy?: string;
    deletedBy?: string;
    auditTrail: AuditEntry[];
}

interface AuditEntry {
    actor?: string;
    request?: object;
    operation?: string;
    ocurredAt?: Date;
}

export interface AppDetails {
    createdAt: Date;
    user: string;
    method: string;
    detail: string;
}

// The stored `user` is a userId; the response carries the author's email, or null when the
// reader may not see it or the author does not resolve
export type AppDetailsResponse = Omit<AppDetails, 'user'> & { user: string | null };