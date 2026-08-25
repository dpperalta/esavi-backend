import { InvestigationVaccineAdministered } from '../investigationVaccineAdministered.model';
import { Investigation } from '../investigation.model';
import { VaccineWhodrug } from '../vaccineWhodrug.model';

export const initInvestigationVaccineAdministeredAssociations = (): void => {
    // InvestigationVaccineAdministered -> Investigation. This is the include that implements the
    // inherited visibility: every read of 001, 002A, 002B, 003, 004 and 006 joins the parent with
    // required: true and checks its isActive
    InvestigationVaccineAdministered.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasMany and not hasOne, because investigationId carries no UNIQUE: an investigation records N
    // administered vaccines. The alias collides with none of the six earlier satellites - source,
    // autopsy, teamMembers, medicalHistory, clinicalEvaluation, vaccinationContext. It is declared
    // so queries can use it - the log dump of ESAVI-INVESTGN-005C counts through it - and it is
    // added to no response of investigation, whose HTTP contract does not change
    Investigation.hasMany(InvestigationVaccineAdministered, { foreignKey: 'investigationId', as: 'vaccinesAdministered' });

    // The master that resolves the vaccine. Same alias notificationVaccine uses over the same
    // dictionary, on a different model and therefore without collision. The include never filters
    // by isActive: an entry deactivated after the fact still resolves in the reads
    InvestigationVaccineAdministered.belongsTo(VaccineWhodrug, { foreignKey: 'vaccineWhodrugId', as: 'vaccineWhodrug' });
}
