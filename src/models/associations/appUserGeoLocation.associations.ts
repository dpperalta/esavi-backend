import { AppUserGeoLocation } from '../appUserGeoLocation.model';
import { AppUser } from '../appUser.model';
import { GeoLocation } from '../geoLocation.model';

export const initAppUserGeoLocationAssociations = (): void => {
    // AppUserGeoLocation -> AppUser (assigned user)
    AppUser.hasMany(AppUserGeoLocation, { foreignKey: 'userId', as: 'geoAssignments' });
    AppUserGeoLocation.belongsTo(AppUser, { foreignKey: 'userId', as: 'user' });

    // AppUserGeoLocation -> GeoLocation (assigned territory)
    GeoLocation.hasMany(AppUserGeoLocation, { foreignKey: 'geoLocationId', as: 'userAssignments' });
    AppUserGeoLocation.belongsTo(GeoLocation, { foreignKey: 'geoLocationId', as: 'geoLocation' });

    // assignedByUserId is deliberately left without an association: the response
    // returns the raw UUID, so a second belongsTo to AppUser would have no consumer.
}
