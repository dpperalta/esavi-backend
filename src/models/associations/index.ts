import { initAuthAssociations } from './auth.associations';
import { initCatalogAssociations } from './catalog.associations';
import { initGeographicAssociations } from './geographic.associations';
import { initHealthFacilityAssociations } from './healthFacility.associations';

export const initAssociations = (): void => {
    initAuthAssociations();
    initGeographicAssociations();
    initCatalogAssociations();
    initHealthFacilityAssociations();
}