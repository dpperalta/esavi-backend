import { EvaluationInstitution } from '../evaluationInstitution.model';
import { InvestigationClinicalEvaluation } from '../investigationClinicalEvaluation.model';
import { HealthFacility } from '../healthFacility.model';
import { CatalogItem } from '../catalogItem.model';

export const initEvaluationInstitutionAssociations = (): void => {
    // EvaluationInstitution -> InvestigationClinicalEvaluation. The association that is easiest to
    // write wrong, because the name of the column suggests the opposite: investigationId targets the
    // clinical evaluation and not the investigation. Both would compile and both would even join,
    // since the UUID is the same one, until the day a clinical evaluation is missing for a live
    // investigation - which is exactly the case the guard of ESAVI-EVALINST-001 has to catch.
    // It is the first hop of the inherited visibility chain, and the only one of the two whose link
    // is checked by deletedAt: this parent has no isActive column at all
    EvaluationInstitution.belongsTo(InvestigationClinicalEvaluation, { foreignKey: 'investigationId', as: 'clinicalEvaluation' });

    // hasMany, and not the hasOne the parent got from investigation: here investigationId carries no
    // UNIQUE, so nothing limits how many institutions hang from one clinical evaluation. It is
    // declared because the two log dumps of the ON DELETE CASCADE need it - the one of
    // ESAVI-INVCLIEV-005C and the two hop one of ESAVI-INVESTGN-005C. It is included in no response
    // of investigationClinicalEvaluation: the HTTP contract of that entity does not change
    InvestigationClinicalEvaluation.hasMany(EvaluationInstitution, { foreignKey: 'investigationId', as: 'evaluationInstitutions' });

    // EvaluationInstitution -> HealthFacility. No inverse hasMany, for the same reason the clinical
    // catalogs gave: nobody needs it, and declaring it would invite including institutions in the
    // health facility responses
    EvaluationInstitution.belongsTo(HealthFacility, { foreignKey: 'healthFacilityId', as: 'healthFacility' });

    // EvaluationInstitution -> CatalogItem, the institution type. No inverse hasMany either. The
    // foreign key of the DDL does not tell the catalogType apart, so the only defence against an item
    // of sex stored as an institution type is the double hop the service checks against
    // evaluationInstitutionType
    EvaluationInstitution.belongsTo(CatalogItem, { foreignKey: 'evaluationInstitutionTypeItemId', as: 'institutionType' });
}
