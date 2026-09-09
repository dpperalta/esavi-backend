import { InvestigationDiagnostic } from '../investigationDiagnostic.model';
import { Investigation } from '../investigation.model';
import { DiagnosticTerm } from '../diagnosticTerm.model';
import { CatalogItem } from '../catalogItem.model';

export const initInvestigationDiagnosticAssociations = (): void => {
    // InvestigationDiagnostic -> Investigation. This is the include that implements the inherited
    // visibility, and it is a single hop: unlike investigationPregnancyCondition, which had to walk
    // through investigationMedicalHistory with paranoid: false, the parent here carries its own
    // isActive and the state is read in one go. Every read of 002A, 002B, 003, 004 and of the rows
    // of 006 joins it with required: true
    InvestigationDiagnostic.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasMany and not hasOne, because investigationId carries no UNIQUE: an investigation records N
    // final diagnoses. The alias collides with none of the ten the satellites already declare -
    // source, autopsy, teamMembers, medicalHistory, clinicalEvaluation, vaccinationContext,
    // vaccinesAdministered, coldChain, administrationError, community. It is declared because the
    // log dump of ESAVI-INVESTGN-005C counts through it, and it is added to no response of
    // investigation, whose HTTP contract does not change
    Investigation.hasMany(InvestigationDiagnostic, { foreignKey: 'investigationId', as: 'diagnostics' });

    // The clinical master that resolves the diagnosis. No inverse hasMany from DiagnosticTerm, for
    // the reason notificationEvent gave when it opened this key and notificationPregnancyComplication,
    // investigationPregnancyCondition and notificationMedicalHistory repeated: nobody needs it, and
    // declaring it would invite including diagnoses in the catalog responses
    InvestigationDiagnostic.belongsTo(DiagnosticTerm, { foreignKey: 'diagnosticTermId', as: 'diagnosticTerm' });

    // The diagnosticType item - presumptive, confirmed or differential. No inverse from CatalogItem,
    // for the same reason. The include never filters by isActive: the response carries the item's
    // own isActive so the client sees the real state of a type deactivated after the fact
    InvestigationDiagnostic.belongsTo(CatalogItem, { foreignKey: 'diagnosticTypeItemId', as: 'diagnosticType' });
}
