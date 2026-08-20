import { NotificationPregnancy } from '../notificationPregnancy.model';
import { Notification } from '../notification.model';

export const initNotificationPregnancyAssociations = (): void => {
    // NotificationPregnancy -> Notification. Inherited visibility of a single hop: the pregnancy
    // hangs straight from the header, so every read includes the notification and answers 404 when
    // it is withdrawn. The two level chain notificationDiluent introduced does not apply here.
    // The same association also carries the three hop include notification -> case -> patient that
    // ESAVI-NOTIFPRG-001 walks to read patient.sexItemId without a second query
    NotificationPregnancy.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasOne, and never the collection form, because UQ_notificationPregnancy_notification imposes it, the same
    // criterion notification.associations.ts applied to EsaviCase.hasOne(Notification). It is
    // declared because the log dump of the ESAVI-NOTIFCN-005C cascade needs it to name the pregnancy
    // the purge destroys, and it is included in no response of notification: the HTTP contract of
    // that entity does not change
    Notification.hasOne(NotificationPregnancy, { foreignKey: 'notificationId', as: 'pregnancy' });
}
