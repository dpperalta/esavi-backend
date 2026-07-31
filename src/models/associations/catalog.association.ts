import { CatalogType } from '../catalogType.model';
import { CatalogItem } from '../catalogItem.model';

export const initCatalogAssociations = () => {
    // CatalogType <-> CatalogItem
    CatalogType.hasMany(CatalogItem, { foreignKey: 'catalogTypeId', as: 'catalogItems' });
    CatalogItem.belongsTo(CatalogType, { foreignKey: 'catalogTypeId', as: 'catalogType' });
}