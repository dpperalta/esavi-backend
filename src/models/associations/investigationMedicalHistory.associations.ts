import { InvestigationMedicalHistory } from '../investigationMedicalHistory.model';
import { Investigation } from '../investigation.model';
import { CatalogItem } from '../catalogItem.model';

export const initInvestigationMedicalHistoryAssociations = (): void => {
    // Both sides of the first association use the same column, because the primary key of the
    // medical history and the primary key of the target are the same one: investigationId is PK and
    // FK at once

    // InvestigationMedicalHistory -> Investigation. This is the include that implements the
    // inherited visibility: the table has no state of its own, so every read joins its parent and
    // checks its isActive
    InvestigationMedicalHistory.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasOne and not hasMany because the shared primary key imposes it. The alias does not collide
    // with the `source` of SPEC F29, the `autopsy` of SPEC F30 nor the `teamMembers` of SPEC F31,
    // all declared over this same model. It is declared because the three deletedAt cascades and
    // the log dump of ESAVI-INVESTGN-005C need it; it is not added to any response of
    // investigation, whose HTTP contract does not change
    Investigation.hasOne(InvestigationMedicalHistory, { foreignKey: 'investigationId', as: 'medicalHistory' });

    // The four catalog keys of the pregnancy block, declared on the side that owns them and with no
    // inverse hasMany, as notificationPregnancyComplication did with complicationType: nobody needs
    // it, and declaring it would invite including medical histories in the catalog responses.
    // The FK of the DDL points at catalogItem without distinguishing the type, so the service is
    // what checks each item belongs to its own catalogType
    InvestigationMedicalHistory.belongsTo(CatalogItem, { foreignKey: 'gestationMethodItemId', as: 'gestationMethod' });
    InvestigationMedicalHistory.belongsTo(CatalogItem, { foreignKey: 'deliveryItemId', as: 'delivery' });
    InvestigationMedicalHistory.belongsTo(CatalogItem, { foreignKey: 'birthItemId', as: 'birth' });
    InvestigationMedicalHistory.belongsTo(CatalogItem, { foreignKey: 'pregnancyOutcomeItemId', as: 'pregnancyOutcome' });
}
