import { Notification } from '../notification.model';
import { EsaviCase } from '../esaviCase.model';
import { CatalogItem } from '../catalogItem.model';

export const initNotificationAssociations = (): void => {
    // Notification -> EsaviCase
    Notification.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // Notification -> CatalogItem (outcome)
    Notification.belongsTo(CatalogItem, { foreignKey: 'outcomeItemId', as: 'outcome' });

    // hasOne and not hasMany because UQ_notification_case imposes it, the same criterion the
    // classification satellite already follows. It is not included in any response of esaviCase,
    // whose HTTP contract does not change
    EsaviCase.hasOne(Notification, { foreignKey: 'caseId', as: 'notification' });
}
