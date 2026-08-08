import { Patient } from '../patient.model';
import { CatalogItem } from '../catalogItem.model';
import { GeoLocation } from '../geoLocation.model';

export const initPatientAssociations = (): void => {
    // Patient -> CatalogItem (sex)
    CatalogItem.hasMany(Patient, { foreignKey: 'sexItemId', as: 'patients' });
    Patient.belongsTo(CatalogItem, { foreignKey: 'sexItemId', as: 'sex' });

    // Patient -> GeoLocation (residence)
    GeoLocation.hasMany(Patient, { foreignKey: 'residenceGeoLocationId', as: 'patients' });
    Patient.belongsTo(GeoLocation, { foreignKey: 'residenceGeoLocationId', as: 'residence' });
}
