import { HealthFacility } from '../healthFacility.model';
import { CatalogItem } from '../catalogItem.model';
import { GeoLocation }  from '../geoLocation.model';

export const initHealthFacilityAssociations = (): void => {
    // HealthFacility -> CatalogItem (facilityType)
    CatalogItem.hasMany(HealthFacility, { foreignKey: 'facilityTypeItemId', as: 'healthFacilities' });
    HealthFacility.belongsTo(CatalogItem, { foreignKey: 'facilityTypeItemId', as: 'facilityType' });

    // HealthFacility -> GeoLocation (geoLocation)
    GeoLocation.hasMany(HealthFacility, { foreignKey: 'geoLocationId', as: 'healthFacilities' });
    HealthFacility.belongsTo(GeoLocation, { foreignKey: 'geoLocationId', as: 'geoLocation' });

    // HealthFacility -> HealthFacility (parent-child relationship)
    HealthFacility.hasMany(HealthFacility, { foreignKey: 'parentHealthFacilityId', as: 'children' });
    HealthFacility.belongsTo(HealthFacility, { foreignKey: 'parentHealthFacilityId', as: 'parent' });
}