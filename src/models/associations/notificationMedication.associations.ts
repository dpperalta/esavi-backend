import { NotificationMedication } from '../notificationMedication.model';
import { Notification } from '../notification.model';
import { CatalogItem } from '../catalogItem.model';

export const initNotificationMedicationAssociations = (): void => {
    // NotificationMedication -> Notification
    NotificationMedication.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasMany as in notificationEvent: nothing limits how many medications hang from a
    // notification. It is declared because ESAVI-NOTIFMED-006, the inherited visibility and the
    // log dump of the ESAVI-NOTIFCN-005C cascade need it
    Notification.hasMany(NotificationMedication, { foreignKey: 'notificationId', as: 'medications' });

    // The two catalog keys. No inverse hasMany is declared from catalogItem: nobody needs it, and
    // declaring it would invite including medications in the catalog responses, whose contract
    // does not change
    NotificationMedication.belongsTo(CatalogItem, { foreignKey: 'pharmaceuticalFormItemId', as: 'pharmaceuticalForm' });
    NotificationMedication.belongsTo(CatalogItem, { foreignKey: 'administrationRouteItemId', as: 'administrationRoute' });
}
