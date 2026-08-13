import { NonSevereNotification } from '../nonSevereNotification.model';
import { Notification } from '../notification.model';
import { HealthFacility } from '../healthFacility.model';
import { CatalogItem } from '../catalogItem.model';
import { GeoLocation } from '../geoLocation.model';

export const initNonSevereNotificationAssociations = (): void => {
    // The first two use the same column on both sides, because the primary key of the source and
    // the primary key of the target are the same one: notificationId is PK and FK at once

    // NonSevereNotification -> Notification
    NonSevereNotification.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasOne and not hasMany because the shared primary key imposes it. It is declared because
    // the cascade from the header and the log dump of ESAVI-NOTIFCN-005C need it; it is not
    // added to any response of notification, whose HTTP contract does not change
    Notification.hasOne(NonSevereNotification, { foreignKey: 'notificationId', as: 'nonSevereNotification' });

    // The three vaccination place keys. No inverse hasMany is declared from healthFacility,
    // catalogItem or geoLocation: nobody needs them, and declaring them would invite including
    // this detail in the responses of those entities, whose contract does not change either
    NonSevereNotification.belongsTo(HealthFacility, { foreignKey: 'vaccinationHealthFacilityId', as: 'vaccinationHealthFacility' });
    NonSevereNotification.belongsTo(CatalogItem, { foreignKey: 'vaccinationSiteItemId', as: 'vaccinationSite' });
    NonSevereNotification.belongsTo(GeoLocation, { foreignKey: 'vaccinationGeoLocationId', as: 'vaccinationGeoLocation' });
}
