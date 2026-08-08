import { initAuthAssociations } from './auth.associations';
import { initCatalogAssociations } from './catalog.associations';
import { initGeographicAssociations } from './geographic.associations';
import { initHealthFacilityAssociations } from './healthFacility.associations';
import { initAppUserGeoLocationAssociations } from './appUserGeoLocation.associations';
import { initPatientAssociations } from './patient.associations';
import { initEsaviCaseAssociations } from './esaviCase.associations';

export const initAssociations = (): void => {
    initAuthAssociations();
    initGeographicAssociations();
    initCatalogAssociations();
    initHealthFacilityAssociations();
    initAppUserGeoLocationAssociations();
    initPatientAssociations();
    initEsaviCaseAssociations();
}