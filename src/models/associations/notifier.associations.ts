import { Notifier } from '../notifier.model';
import { EsaviCase } from '../esaviCase.model';
import { GeoLocation } from '../geoLocation.model';
import { CatalogItem } from '../catalogItem.model';

export const initNotifierAssociations = (): void => {
    // Notifier -> EsaviCase
    Notifier.belongsTo(EsaviCase, { foreignKey: 'caseId', as: 'case' });

    // Notifier -> CatalogItem (profession)
    Notifier.belongsTo(CatalogItem, { foreignKey: 'professionItemId', as: 'profession' });

    // Notifier -> GeoLocation
    Notifier.belongsTo(GeoLocation, { foreignKey: 'geoLocationId', as: 'geoLocation' });

    // The inverse is declared here and not in esaviCase.associations.ts because it exists for
    // this entity: the ESAVI-CASE-005A cascade walks the notifiers of the case. It is not
    // included in any response of esaviCase, whose HTTP contract does not change
    EsaviCase.hasMany(Notifier, { foreignKey: 'caseId', as: 'notifiers' });
}
