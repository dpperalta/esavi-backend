import { InvestigationClinicalEvaluation } from '../investigationClinicalEvaluation.model';
import { Investigation } from '../investigation.model';

export const initInvestigationClinicalEvaluationAssociations = (): void => {
    // Both sides use the same column, because the primary key of the clinical evaluation and the
    // primary key of the target are the same one: investigationId is PK and FK at once

    // InvestigationClinicalEvaluation -> Investigation. This is the include that implements the
    // inherited visibility: the table has no state of its own, so every read joins its parent and
    // checks its isActive. It is the only association of the entity — there is no FK to catalogItem
    InvestigationClinicalEvaluation.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasOne and not hasMany because the shared primary key imposes it. The alias does not collide
    // with the `source` of SPEC F29, the `autopsy` of SPEC F30, the `teamMembers` of SPEC F31 nor
    // the `medicalHistory` of SPEC F32, all declared over this same model. It is declared because
    // the three deletedAt cascades and the log dump of ESAVI-INVESTGN-005C need it; it is not added
    // to any response of investigation, whose HTTP contract does not change
    Investigation.hasOne(InvestigationClinicalEvaluation, { foreignKey: 'investigationId', as: 'clinicalEvaluation' });
}
