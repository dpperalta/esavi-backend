import { NotificationVaccine } from '../notificationVaccine.model';
import { Notification } from '../notification.model';
import { VaccineWhodrug } from '../vaccineWhodrug.model';

export const initNotificationVaccineAssociations = (): void => {
    // NotificationVaccine -> Notification
    NotificationVaccine.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasMany as in notificationEvent and notificationMedication: nothing limits how many vaccines
    // hang from a notification. It is declared because ESAVI-NOTIFVAC-006, the inherited visibility
    // and the log dump of the ESAVI-NOTIFCN-005C cascade need it
    Notification.hasMany(NotificationVaccine, { foreignKey: 'notificationId', as: 'vaccines' });

    // The master key. No inverse hasMany is declared from vaccineWhodrug: nobody needs it, and
    // declaring it would invite including notifications in the master responses, whose contract
    // does not change. This is the first incoming foreign key of that entity, and it is declared
    // here - on the side that owns the key - which is why vaccineWhodrug still has no associations
    // file of its own
    NotificationVaccine.belongsTo(VaccineWhodrug, { foreignKey: 'vaccineWhodrugId', as: 'vaccineWhodrug' });

    // No association towards notificationDiluent: that table has no model, and this spec does not
    // give it one. Its only appearance is the raw SQL count the 005C dumps to the log
}
