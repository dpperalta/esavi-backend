export interface CreateCatalogItem {
    catalogTypeId: string;
    code?: string | null;
    name: string;
    value: string;
    description?: string | null;
    sortOrder?: number | null;
    metadata?: object | null;
}