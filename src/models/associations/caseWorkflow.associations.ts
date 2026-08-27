import { CaseWorkflow } from '../caseWorkflow.model';
import { EsaviCase } from '../esaviCase.model';
import { CatalogItem } from '../catalogItem.model';

export const initCaseWorkflowAssociations = (): void => {
    // CaseWorkflow -> EsaviCase
    CaseWorkflow.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // CaseWorkflow -> CatalogItem, twice over the same catalogType (caseWorkflowStatus). Without
    // distinct aliases Sequelize cannot resolve two associations to the same model, and each
    // alias has to match the include name of the service exactly
    CaseWorkflow.belongsTo(CatalogItem, { foreignKey: 'statusItemId', as: 'status' });
    CaseWorkflow.belongsTo(CatalogItem, { foreignKey: 'previousStatusItemId', as: 'previousStatus' });

    // hasOne and not hasMany because UQ_caseWorkflow_case imposes it: one workflow row per case
    EsaviCase.hasOne(CaseWorkflow, { foreignKey: 'caseId', as: 'workflow' });
}
