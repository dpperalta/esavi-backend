import { NotificationPregnancyComplication } from '../notificationPregnancyComplication.model';
import { NotificationPregnancy } from '../notificationPregnancy.model';
import { DiagnosticTerm } from '../diagnosticTerm.model';
import { CatalogItem } from '../catalogItem.model';

export const initNotificationPregnancyComplicationAssociations = (): void => {
    // NotificationPregnancyComplication -> NotificationPregnancy. First hop of the inherited
    // visibility chain: every read of a complication includes its pregnancy and, inside it, the
    // notification the pregnancy already declares, so a complication of a withdrawn pregnancy or
    // of a withdrawn notification answers 404. It is the two hop chain notificationDiluent
    // introduced, with a one to one first hop instead of a one to many
    NotificationPregnancyComplication.belongsTo(NotificationPregnancy, { foreignKey: 'pregnancyId', as: 'pregnancy' });

    // hasMany, and not the hasOne the parent got from notification: pregnancyId carries no UNIQUE,
    // so nothing limits how many complications hang from a pregnancy. It is declared because the
    // log dump of the ESAVI-NOTIFCN-005C cascade walks notification -> pregnancy -> complications
    // to list what the third hop destroys. It is included in no response of notificationPregnancy:
    // the HTTP contract of that entity does not change
    NotificationPregnancy.hasMany(NotificationPregnancyComplication, { foreignKey: 'pregnancyId', as: 'complications' });

    // NotificationPregnancyComplication -> DiagnosticTerm. No inverse hasMany from DiagnosticTerm,
    // for the reason notificationEvent gave when it opened this key: nobody needs it, and declaring
    // it would invite including complications in the catalog responses
    NotificationPregnancyComplication.belongsTo(DiagnosticTerm, { foreignKey: 'diagnosticTermId', as: 'diagnosticTerm' });

    // The complication type, an item of the pregnancyComplicationType catalog. Declared on the side
    // that owns the key and with no inverse, as notificationDiluent did with diluentCatalog
    NotificationPregnancyComplication.belongsTo(CatalogItem, { foreignKey: 'complicationTypeItemId', as: 'complicationType' });
}
