import { Classification } from '../classification.model';
import { EsaviCase } from '../esaviCase.model';
import { CatalogItem } from '../catalogItem.model';

export const initClassificationAssociations = (): void => {
    // Classification -> EsaviCase
    Classification.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // Classification -> CatalogItem (age unit)
    Classification.belongsTo(CatalogItem, { foreignKey: 'ageUnitItemId', as: 'ageUnit' });

    // hasOne and not hasMany because UQ_classification_case imposes it. The ESAVI-CASE-005A
    // cascade does not need it — the bulk update filters by caseId — but the inverse of notifier
    // is already declared and keeping the criterion saves the next satellite from deciding again.
    // It is not included in any response of esaviCase, whose HTTP contract does not change
    EsaviCase.hasOne(Classification, { foreignKey: 'caseId', as: 'classification' });
}
