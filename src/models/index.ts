import { sequelize } from '../database/connection';
import { AppUser } from './appUser.model';
import { AppRole } from './appRole.model';
import { AppUserRole } from './appUserRole.model';
import { GeoLevelType } from './geoLevelType.model';
import { GeoLocation } from './geoLocation.model';
import { initAssociations } from './associations';
import { CatalogType } from './catalogType.model';
import { CatalogItem } from './catalogItem.model';
import { HealthFacility } from './healthFacility.model';
import { AppUserGeoLocation } from './appUserGeoLocation.model';
import { Patient } from './patient.model';
import { EsaviCase } from './esaviCase.model';
import { Notifier } from './notifier.model';
import { Classification } from './classification.model';
import { Notification } from './notification.model';
import { SevereNotification } from './severeNotification.model';
import { NonSevereNotification } from './nonSevereNotification.model';
import { DiagnosticTerm } from './diagnosticTerm.model';
import { NotificationEvent } from './notificationEvent.model';
import { NotificationMedication } from './notificationMedication.model';
import { NotificationVaccine } from './notificationVaccine.model';
import { VaccineWhodrug } from './vaccineWhodrug.model';

export const initModels = (): void => {
    initAssociations();
};

export { 
    sequelize,
    AppUser,
    AppRole,
    AppUserRole,
    GeoLevelType,
    GeoLocation,
    CatalogType,
    CatalogItem,
    HealthFacility,
    AppUserGeoLocation,
    Patient,
    EsaviCase,
    Notifier,
    Classification,
    Notification,
    SevereNotification,
    NonSevereNotification,
    DiagnosticTerm,
    NotificationEvent,
    NotificationMedication,
    NotificationVaccine,
    VaccineWhodrug
};