import { NotificationMedicalHistory } from '../notificationMedicalHistory.model';
import { Notification } from '../notification.model';
import { DiagnosticTerm } from '../diagnosticTerm.model';

export const initNotificationMedicalHistoryAssociations = (): void => {
    // NotificationMedicalHistory -> Notification. The whole inherited visibility of this entity: a
    // single hop, because the parent carries its own isActive. It is the plain form of
    // notificationMedication and notificationVaccine, not the two hop chain with paranoid: false
    // that investigationPregnancyCondition needed to reach a parent whose only mark was deletedAt
    NotificationMedicalHistory.belongsTo(Notification, { foreignKey: 'notificationId', as: 'notification' });

    // hasMany as in events, medications and vaccines: notificationId carries no UNIQUE, so nothing
    // limits how many antecedents hang from one notification. It is declared because
    // ESAVI-MEDHIST-006, the inherited visibility and the log dump of the ESAVI-NOTIFCN-005C cascade
    // need it. It is included in no response of notification: the HTTP contract of that entity does
    // not change, and the flag hasRelevantMedicalHistory is never written from this side
    Notification.hasMany(NotificationMedicalHistory, { foreignKey: 'notificationId', as: 'medicalHistories' });

    // The master key. No inverse hasMany is declared from diagnosticTerm, for the reason
    // notificationEvent gave when it opened this key and notificationPregnancyComplication and
    // investigationPregnancyCondition repeated: nobody needs it, and declaring it would invite
    // including antecedents in the catalog responses
    NotificationMedicalHistory.belongsTo(DiagnosticTerm, { foreignKey: 'diagnosticTermId', as: 'diagnosticTerm' });
}
