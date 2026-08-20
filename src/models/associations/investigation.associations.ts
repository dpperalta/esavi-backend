import { Investigation } from '../investigation.model';
import { EsaviCase } from '../esaviCase.model';
import { CatalogItem } from '../catalogItem.model';
import { HealthFacility } from '../healthFacility.model';
import { GeoLocation } from '../geoLocation.model';

export const initInvestigationAssociations = (): void => {
    // Investigation -> EsaviCase
    Investigation.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // Investigation -> CatalogItem, twice. The two need distinct aliases: without them Sequelize
    // cannot resolve two associations pointing at the same model
    Investigation.belongsTo(CatalogItem, { foreignKey: 'statusItemId', as: 'status' });
    Investigation.belongsTo(CatalogItem, { foreignKey: 'vaccinationSiteItemId', as: 'vaccinationSite' });

    // Investigation -> HealthFacility / GeoLocation (where the patient was vaccinated)
    Investigation.belongsTo(HealthFacility, { foreignKey: 'vaccinationHealthFacilityId', as: 'vaccinationHealthFacility' });
    Investigation.belongsTo(GeoLocation, { foreignKey: 'vaccinationGeoLocationId', as: 'vaccinationGeoLocation' });

    // hasOne and not hasMany because UQ_investigation_case imposes it, following the criterion F09
    // fixed for classification. The ESAVI-CASE-005A cascade does not need it — the bulk update
    // filters by caseId — and it is not included in any response of esaviCase, whose HTTP contract
    // does not change
    EsaviCase.hasOne(Investigation, { foreignKey: 'caseId', as: 'investigation' });
}
