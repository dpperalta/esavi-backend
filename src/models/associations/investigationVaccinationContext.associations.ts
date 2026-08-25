import { InvestigationVaccinationContext } from '../investigationVaccinationContext.model';
import { Investigation } from '../investigation.model';
import { CatalogItem } from '../catalogItem.model';

export const initInvestigationVaccinationContextAssociations = (): void => {
    // Both sides of the first association use the same column, because the primary key of the
    // vaccination context and the primary key of the target are the same one: investigationId is PK
    // and FK at once

    // InvestigationVaccinationContext -> Investigation. This is the include that implements the
    // inherited visibility: the table has no state of its own, so every read joins its parent and
    // checks its isActive
    InvestigationVaccinationContext.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasOne and not hasMany because the shared primary key imposes it. The alias does not collide
    // with the `source` of SPEC F29, the `autopsy` of SPEC F30, the `teamMembers` of SPEC F31, the
    // `medicalHistory` of SPEC F32 nor the `clinicalEvaluation` of SPEC F34, all declared over this
    // same model. It is declared because the three deletedAt cascades and the log dump of
    // ESAVI-INVESTGN-005C need it; it is not added to any response of investigation, whose HTTP
    // contract does not change
    Investigation.hasOne(InvestigationVaccinationContext, { foreignKey: 'investigationId', as: 'vaccinationContext' });

    // THE TWO FKs THAT POINT AT THE SAME MODEL, and the reason the aliases are mandatory and must
    // differ. This is the first entity of the repository with two columns resolved against one
    // catalog - both against vaccinationMoment - so without distinct aliases Sequelize cannot tell
    // the two includes apart and every response would resolve the same column twice. It is a silent
    // failure: a row whose two FKs hold the same item would look correct anyway, which is why the
    // acceptance criteria exercise a row with FIRST_HOURS in one column and LAST_HOURS in the other.
    // No inverse hasMany on either: nobody needs it, and declaring it would invite including
    // vaccination contexts in the catalog item responses
    InvestigationVaccinationContext.belongsTo(CatalogItem, { foreignKey: 'momentItemId', as: 'moment' });
    InvestigationVaccinationContext.belongsTo(CatalogItem, { foreignKey: 'multidoseItemId', as: 'multidoseMoment' });
}
