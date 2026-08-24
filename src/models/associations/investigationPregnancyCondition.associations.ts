import { InvestigationPregnancyCondition } from '../investigationPregnancyCondition.model';
import { InvestigationMedicalHistory } from '../investigationMedicalHistory.model';
import { DiagnosticTerm } from '../diagnosticTerm.model';

export const initInvestigationPregnancyConditionAssociations = (): void => {
    // InvestigationPregnancyCondition -> InvestigationMedicalHistory. The association that is
    // easiest to write wrong, because the name of the column suggests the opposite: investigationId
    // targets the medical history and not the investigation. Both would compile and both would even
    // join, since the UUID is the same one, until the day a medical history is missing for a live
    // investigation - which is exactly the case the guard of ESAVI-INVPREG-001 has to catch.
    // It is the first hop of the inherited visibility chain, and the only one of the two whose link
    // is checked by deletedAt: this parent has no isActive column at all
    InvestigationPregnancyCondition.belongsTo(InvestigationMedicalHistory, { foreignKey: 'investigationId', as: 'medicalHistory' });

    // hasMany, and not the hasOne the parent got from investigation: here investigationId carries no
    // UNIQUE, so nothing limits how many conditions hang from one medical history. It is declared
    // because the two log dumps of the ON DELETE CASCADE need it - the one of ESAVI-INVMEDH-005C and
    // the two hop one of ESAVI-INVESTGN-005C. It is included in no response of
    // investigationMedicalHistory: the HTTP contract of that entity does not change
    InvestigationMedicalHistory.hasMany(InvestigationPregnancyCondition, { foreignKey: 'investigationId', as: 'pregnancyConditions' });

    // InvestigationPregnancyCondition -> DiagnosticTerm. No inverse hasMany from DiagnosticTerm, for
    // the reason notificationEvent gave when it opened this key and notificationPregnancyComplication
    // repeated: nobody needs it, and declaring it would invite including conditions in the catalog
    // responses
    InvestigationPregnancyCondition.belongsTo(DiagnosticTerm, { foreignKey: 'diagnosticTermId', as: 'diagnosticTerm' });
}
