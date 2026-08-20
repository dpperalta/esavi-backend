import { Router } from 'express';
import healthRoutes from './health.routes';
import seedRoutes from './seed.routes';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import geoLevelTypeRoutes from './geoLevelType.routes';
import geoLocationRoutes from './geoLocation.routes';
import catalogTypeRoutes from './catalogType.routes';
import catalogItemRoutes from './catalogItem.routes';
import healthFacilityRoutes from './healthFacility.routes';
import appUserGeoLocationRoutes from './appUserGeoLocation.routes';
import appUserRoleRoutes from './appUserRole.routes';
import appRoleRoutes from './appRole.routes';
import patientRoutes from './patient.routes';
import esaviCaseRoutes from './esaviCase.routes';
import notifierRoutes from './notifier.routes';
import classificationRoutes from './classification.routes';
import notificationRoutes from './notification.routes';
import severeNotificationRoutes from './severeNotification.routes';
import nonSevereNotificationRoutes from './nonSevereNotification.routes';
import diagnosticTermRoutes from './diagnosticTerm.routes';
import notificationEventRoutes from './notificationEvent.routes';
import notificationMedicationRoutes from './notificationMedication.routes';
import notificationVaccineRoutes from './notificationVaccine.routes';
import vaccineWhodrugRoutes from './vaccineWhodrug.routes';
import diluentCatalogRoutes from './diluentCatalog.routes';
import notificationDiluentRoutes from './notificationDiluent.routes';
import notificationPregnancyRoutes from './notificationPregnancy.routes';
import notificationPregnancyComplicationRoutes from './notificationPregnancyComplication.routes';
import systemConfigRoutes from './systemConfig.routes';

const router = Router();

router.use('/health', healthRoutes);

// The seed router is never exposed in production; bootstrapping the first
// SUPERADMIN there is a manual SQL step.
if( ( process.env.NODE_ENV || 'development' ) !== 'production' ) {
    router.use('/seed', seedRoutes);
}

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/geo-level-types', geoLevelTypeRoutes);
router.use('/geo-locations', geoLocationRoutes);
router.use('/catalog-types', catalogTypeRoutes);
router.use('/catalog-items', catalogItemRoutes);
router.use('/health-facilities', healthFacilityRoutes);
router.use('/user-geo-locations', appUserGeoLocationRoutes);
router.use('/user-roles', appUserRoleRoutes);
router.use('/roles', appRoleRoutes);
router.use('/patients', patientRoutes);
router.use('/esavi-cases', esaviCaseRoutes);
router.use('/notifiers', notifierRoutes);
router.use('/classifications', classificationRoutes);
router.use('/notifications', notificationRoutes);
router.use('/severe-notifications', severeNotificationRoutes);
router.use('/non-severe-notifications', nonSevereNotificationRoutes);
router.use('/diagnostic-terms', diagnosticTermRoutes);
router.use('/notification-events', notificationEventRoutes);
router.use('/notification-medications', notificationMedicationRoutes);
router.use('/notification-vaccines', notificationVaccineRoutes);
// The base path deliberately diverges from the table name vaccineWhodrug — see the header comment
// of vaccineWhodrug.routes.ts
router.use('/whodrug-vaccines', vaccineWhodrugRoutes);
// The base path deliberately diverges from the table name diluentCatalog — see the header comment
// of diluentCatalog.routes.ts
router.use('/diluents', diluentCatalogRoutes);
// The full table name is kept here, unlike /diluents above: the notification- prefix is what tells
// the two entities apart, and without it they would compete for the same namespace
router.use('/notification-diluents', notificationDiluentRoutes);
router.use('/notification-pregnancies', notificationPregnancyRoutes);
// The notification- prefix tells it apart from investigationPregnancyCondition, which is the
// pregnancy table of the investigation branch
router.use('/notification-pregnancy-complications', notificationPregnancyComplicationRoutes);
router.use('/system-configs', systemConfigRoutes);

export default router;