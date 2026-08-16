import { NotificationEvent } from '../notificationEvent.model';
import { Notification } from '../notification.model';
import { DiagnosticTerm } from '../diagnosticTerm.model';

export const initNotificationEventAssociations = (): void => {
    // NotificationEvent -> Notification
    NotificationEvent.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasMany and not hasOne, unlike the two one to one siblings: nothing limits how many events
    // hang from a notification. It is declared because ESAVI-NOTIFEVT-006, the inherited
    // visibility and the log dump of the ESAVI-NOTIFCN-005C cascade need it
    Notification.hasMany(NotificationEvent, { foreignKey: 'notificationId', as: 'events' });

    // NotificationEvent -> DiagnosticTerm. No inverse hasMany from DiagnosticTerm: nobody needs
    // it, and declaring it would invite including events in the catalog responses, whose
    // contract does not change
    NotificationEvent.belongsTo(DiagnosticTerm, { foreignKey: 'diagnosticTermId', as: 'diagnosticTerm' });
}
