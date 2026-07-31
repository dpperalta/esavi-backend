export interface CreateGeoLevelTypeInput {
    code: string;
    name: string;
    sortOrder: number;
}

export interface UpdateGeoLevelTypeInput {
    code?: string;
    name?: string;
    sortOrder?: number;
    isActive?: boolean;
    appDetails?: object | null;
}