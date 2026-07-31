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