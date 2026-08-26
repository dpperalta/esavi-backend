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
import investigationRoutes from './investigation.routes';
import investigationSourceRoutes from './investigationSource.routes';
import investigationAutopsyRoutes from './investigationAutopsy.routes';
import investigationTeamMemberRoutes from './investigationTeamMember.routes';
import investigationMedicalHistoryRoutes from './investigationMedicalHistory.routes';
import investigationPregnancyConditionRoutes from './investigationPregnancyCondition.routes';
import investigationClinicalEvaluationRoutes from './investigationClinicalEvaluation.routes';
import investigationVaccinationContextRoutes from './investigationVaccinationContext.routes';
import evaluationInstitutionRoutes from './evaluationInstitution.routes';
import investigationVaccineAdministeredRoutes from './investigationVaccineAdministered.routes';
import investigationColdChainRoutes from './investigationColdChain.routes';
import investigationAdministrationErrorRoutes from './investigationAdministrationError.routes';
import investigationCommunityRoutes from './investigationCommunity.routes';
import finalClassificationRoutes from './finalClassification.routes';
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
router.use('/investigations', investigationRoutes);
// The first of the fourteen satellites of investigation. The investigation- prefix is what tells
// it apart from the notification branch, which has its own sources of verification
router.use('/investigation-sources', investigationSourceRoutes);
// The second of the fourteen satellites of investigation: the death and the autopsy of an
// investigated case. Plural in the path like the rest, even though the relation is one to one
router.use('/investigation-autopsies', investigationAutopsyRoutes);
// The third of the fourteen satellites of investigation, and the first of them that is a
// collection: who investigated the case, N rows per investigation and ordered by sortOrder
router.use('/investigation-team-members', investigationTeamMemberRoutes);
// The fourth of the fourteen satellites of investigation: the medical, family and gestational
// history of the investigated patient. Plural in the path like the rest, even though the relation
// is one to one
router.use('/investigation-medical-histories', investigationMedicalHistoryRoutes);
// The first granddaughter of the investigation block: the conditions recorded over the pregnancy the
// medical history declared confirmed. It hangs from investigationMedicalHistory and not from
// investigation, which is why it is entered by /investigation/:id and never by /
router.use('/investigation-pregnancy-conditions', investigationPregnancyConditionRoutes);
// The fifth of the fourteen satellites of investigation, and the sixth with a spec of its own: the
// clinical evaluation of the investigated patient. It is the first satellite with an encrypted
// column — clinicalDetailsPersonName — and the first with no foreign key to catalogItem at all
router.use('/investigation-clinical-evaluations', investigationClinicalEvaluationRoutes);
// The second granddaughter of the investigation block and the first one hanging from the clinical
// evaluation: the institutions that evaluated the patient, with the person who attended. It is the
// first COLLECTION of the repository with encrypted columns — personName and personContact — which
// is why both listings decrypt row by row
router.use('/evaluation-institutions', evaluationInstitutionRoutes);
// The sixth of the fourteen satellites of investigation, and the seventh with a spec of its own:
// the context of the vaccination session in which the investigated dose was administered - the time
// slot, the shared exposure per vial and per batch, and the cluster. It is the first entity of the
// repository with TWO foreign keys resolved against one and the same catalog, vaccinationMoment
router.use('/investigation-vaccination-contexts', investigationVaccinationContextRoutes);

// The seventh of the fourteen satellites of investigation with a spec of its own, and the second
// of them that is a COLLECTION and not a one to one: the vaccines the investigation records as
// administered, with their dose number. The first satellite of investigation since F31 that has
// isActive, and therefore the first of them since then with a complete 005A and 005B
router.use('/investigation-vaccines-administered', investigationVaccineAdministeredRoutes);

// The eighth satellite of investigation with a spec of its own, and the seventh with the exact
// shape of F36: the primary key IS the foreign key, no isActive, dual listing and 006 by case.
// How the investigated vaccine was kept and how it travelled — and the first spec of the series
// that does not add a single line to the DDL: it has no foreign key to catalogItem at all
router.use('/investigation-cold-chains', investigationColdChainRoutes);
router.use('/investigation-administration-errors', investigationAdministrationErrorRoutes);
router.use('/investigation-communities', investigationCommunityRoutes);

// The causality verdict of the WHO/PAHO algorithm — the fifth and last satellite of esaviCase,
// and the only entity of the series whose conditional flag closes a block instead of opening it
router.use('/final-classifications', finalClassificationRoutes);

router.use('/system-configs', systemConfigRoutes);

export default router;