export interface CreateCatalogTypeInput {
    code: string;
    name: string;
    description?: string | null;
    sortOrder?: number | null;
}