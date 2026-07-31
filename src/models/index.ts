import { sequelize } from '../database/connection';
import { AppUser } from './appUser.model';
import { AppRole } from './appRole.model';
import { AppUserRole } from './appUserRole.model';
import { GeoLevelType } from './geoLevelType.model';
import { GeoLocation } from './geoLocation.model';
import { initAssociations } from './associations';
import { CatalogType } from './catalogType.model';
import { CatalogItem } from './catalogItem.model';
import { HealthFacility } from './healthFacility.model';

export const initModels = (): void => {
    initAssociations();
};

export { 
    sequelize,
    AppUser,
    AppRole,
    AppUserRole,
    GeoLevelType,
    GeoLocation,
    CatalogType,
    CatalogItem,
    HealthFacility
};