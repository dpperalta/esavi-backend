import { InvestigationSource } from '../investigationSource.model';
import { Investigation } from '../investigation.model';

export const initInvestigationSourceAssociations = (): void => {
    // Both sides use the same column, because the primary key of the source and the primary key of
    // the target are the same one: investigationId is PK and FK at once

    // InvestigationSource -> Investigation. This is the include that implements the inherited
    // visibility: the table has no state of its own, so every read joins its parent and checks
    // its isActive
    InvestigationSource.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasOne and not hasMany because the shared primary key imposes it. It is declared because the
    // three deletedAt cascades and the log dump of ESAVI-INVESTGN-005C need it; it is not added to
    // any response of investigation, whose HTTP contract does not change
    Investigation.hasOne(InvestigationSource, { foreignKey: 'investigationId', as: 'source' });
}
