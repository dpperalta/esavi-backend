import { FinalClassification } from '../finalClassification.model';
import { EsaviCase } from '../esaviCase.model';
import { CatalogItem } from '../catalogItem.model';

export const initFinalClassificationAssociations = (): void => {
    // FinalClassification -> EsaviCase
    FinalClassification.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // FinalClassification -> CatalogItem, three times over. This is the first entity of the
    // repository with three belongsTo to the same model: the alias is the only thing that tells
    // them apart, and it has to match the include name of the service exactly
    FinalClassification.belongsTo(CatalogItem, { foreignKey: 'importanceAItemId', as: 'importanceA' });
    FinalClassification.belongsTo(CatalogItem, { foreignKey: 'importanceBItemId', as: 'importanceB' });
    FinalClassification.belongsTo(CatalogItem, { foreignKey: 'importanceCItemId', as: 'importanceC' });

    // hasOne and not hasMany because UQ_finalClassification_case imposes it. The ESAVI-CASE-005A
    // cascade does not need it — the bulk update filters by caseId — but the inverses of notifier,
    // classification, notification and investigation are already declared and keeping the
    // criterion closes the fifth and last satellite the same way. It is not included in any
    // response of esaviCase, whose HTTP contract does not change
    EsaviCase.hasOne(FinalClassification, { foreignKey: 'caseId', as: 'finalClassification' });
}
