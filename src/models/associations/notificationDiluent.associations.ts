import { NotificationDiluent } from '../notificationDiluent.model';
import { NotificationVaccine } from '../notificationVaccine.model';
import { DiluentCatalog } from '../diluentCatalog.model';

export const initNotificationDiluentAssociations = (): void => {
    // NotificationDiluent -> NotificationVaccine. This is the first hop of the inherited visibility
    // chain: every read of a diluent includes its vaccine and, inside it, the notification the
    // vaccine already declares, so a diluent of a withdrawn vaccine or of a withdrawn notification
    // answers 404
    NotificationDiluent.belongsTo(NotificationVaccine, { foreignKey: 'vaccineId', as: 'vaccine' });

    // hasMany as in the three older sisters: nothing limits how many diluents hang from a vaccine.
    // It is declared because the log dump of the ESAVI-NOTIFCN-005C cascade walks
    // notification -> vaccines -> diluents to list what the second hop destroys
    NotificationVaccine.hasMany(NotificationDiluent, { foreignKey: 'vaccineId', as: 'diluents' });

    // The master key. No inverse hasMany is declared from diluentCatalog: that entity was left
    // deliberately without an associations file for having no outgoing foreign keys, and this is
    // its first incoming one, declared here - on the side that owns the key - exactly as
    // notificationVaccine did with vaccineWhodrug
    NotificationDiluent.belongsTo(DiluentCatalog, { foreignKey: 'diluentCatalogId', as: 'diluentCatalog' });
}
