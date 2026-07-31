import { GeoLevelType } from '../geoLevelType.model';
import { GeoLocation } from '../geoLocation.model';

export const initGeographicAssociations = ():void => {
    // GeoLevelType <-> GeoLocation
    GeoLevelType.hasMany(GeoLocation, { foreignKey: 'geoLevelTypeId', as: 'geoLocations' });
    GeoLocation.belongsTo(GeoLevelType, { foreignKey: 'geoLevelTypeId', as: 'geoLevelType' });
    // Self-referential association for parent-child relationship in GeoLocation
    GeoLocation.hasMany(GeoLocation, { foreignKey: 'parentGeoLocationId', as: 'children' });
    GeoLocation.belongsTo(GeoLocation, { foreignKey: 'parentGeoLocationId', as: 'parent' });
};