import { initAuthAssociations } from './auth.associations';
import { initCatalogAssociations } from './catalog.associations';
import { initGeographicAssociations } from './geographic.associations';
import { initHealthFacilityAssociations } from './healthFacility.associations';
import { initAppUserGeoLocationAssociations } from './appUserGeoLocation.associations';
import { initPatientAssociations } from './patient.associations';
import { initEsaviCaseAssociations } from './esaviCase.associations';
import { initNotifierAssociations } from './notifier.associations';
import { initClassificationAssociations } from './classification.associations';
import { initNotificationAssociations } from './notification.associations';
import { initSevereNotificationAssociations } from './severeNotification.associations';
import { initNonSevereNotificationAssociations } from './nonSevereNotification.associations';
import { initNotificationEventAssociations } from './notificationEvent.associations';
import { initNotificationMedicationAssociations } from './notificationMedication.associations';
import { initNotificationVaccineAssociations } from './notificationVaccine.associations';
import { initNotificationDiluentAssociations } from './notificationDiluent.associations';
import { initSystemConfigAssociations } from './systemConfig.associations';

export const initAssociations = (): void => {
    initAuthAssociations();
    initGeographicAssociations();
    initCatalogAssociations();
    initHealthFacilityAssociations();
    initAppUserGeoLocationAssociations();
    initPatientAssociations();
    initEsaviCaseAssociations();
    initNotifierAssociations();
    initClassificationAssociations();
    initNotificationAssociations();
    initSevereNotificationAssociations();
    initNonSevereNotificationAssociations();
    initNotificationEventAssociations();
    initNotificationMedicationAssociations();
    initNotificationVaccineAssociations();
    initNotificationDiluentAssociations();
    initSystemConfigAssociations();
}