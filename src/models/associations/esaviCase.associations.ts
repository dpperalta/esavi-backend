import { EsaviCase } from '../esaviCase.model';
import { Patient } from '../patient.model';
import { HealthFacility } from '../healthFacility.model';

// The inverse hasMany associations are deliberately not declared: no operation of SPEC F06
// navigates from patient or healthFacility towards their cases, and declaring them invites
// including cases in the responses of those two entities, which is a contract change
export const initEsaviCaseAssociations = (): void => {
    // EsaviCase -> Patient
    EsaviCase.belongsTo(Patient, { foreignKey: 'patientId', as: 'patient' });

    // EsaviCase -> HealthFacility
    EsaviCase.belongsTo(HealthFacility, { foreignKey: 'healthFacilityId', as: 'healthFacility' });
}
