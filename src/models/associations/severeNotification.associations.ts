import { SevereNotification } from '../severeNotification.model';
import { Notification } from '../notification.model';

export const initSevereNotificationAssociations = (): void => {
    // Both sides use the same column, because the primary key of the source and the primary key
    // of the target are the same one: notificationId is PK and FK at once

    // SevereNotification -> Notification
    SevereNotification.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasOne and not hasMany because the shared primary key imposes it. It is declared because
    // the cascade from the header and the log dump of ESAVI-NOTIFCN-005C need it; it is not
    // added to any response of notification, whose HTTP contract does not change
    Notification.hasOne(SevereNotification, { foreignKey: 'notificationId', as: 'severeNotification' });
}
