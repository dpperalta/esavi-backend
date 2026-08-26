import { InvestigationCommunity } from '../investigationCommunity.model';
import { Investigation } from '../investigation.model';

export const initInvestigationCommunityAssociations = (): void => {
    // Both sides use the same column, because the primary key of the community record and the
    // primary key of the target are the same one: investigationId is PK and FK at once

    // InvestigationCommunity -> Investigation. This is the include that implements the inherited
    // visibility: the table has no state of its own, so every read joins its parent and checks its
    // isActive
    InvestigationCommunity.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasOne and not hasMany because the shared primary key imposes it. The alias does not collide
    // with the `source` of SPEC F29, the `autopsy` of SPEC F30, the `teamMembers` of SPEC F31, the
    // `medicalHistory` of SPEC F32, the `clinicalEvaluation` of SPEC F34, the `vaccinationContext`
    // of SPEC F36, the `vaccinesAdministered` of SPEC F37, the `coldChain` of SPEC F38 nor the
    // `administrationError` of SPEC F39, all declared over this same model. It is declared because
    // the three deletedAt cascades and the log dump of ESAVI-INVESTGN-005C need it; it is not added
    // to any response of investigation, whose HTTP contract does not change
    Investigation.hasOne(InvestigationCommunity, { foreignKey: 'investigationId', as: 'community' });

    // TWO ASSOCIATIONS AND NOT ONE MORE. This table has NO FK to catalogItem, so there is not a
    // single catalog include in the whole entity
}
