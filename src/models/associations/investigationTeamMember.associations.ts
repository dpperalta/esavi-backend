import { InvestigationTeamMember } from '../investigationTeamMember.model';
import { Investigation } from '../investigation.model';

export const initInvestigationTeamMemberAssociations = (): void => {
    // InvestigationTeamMember -> Investigation. This is the include that implements the inherited
    // visibility: every read of 001, 003, 004, 006 and the two listings joins the parent with
    // required: true and checks its isActive. Unlike the two one to one satellites, here the FK is
    // a plain NOT NULL column and not the primary key
    InvestigationTeamMember.belongsTo(Investigation, { foreignKey: 'investigationId', as: 'investigation' });

    // hasMany and not hasOne: the first satellite of investigation that is a collection. The alias
    // does not collide with the `source` of SPEC F29 nor the `autopsy` of SPEC F30. It is declared
    // so queries can use it — the log dump of ESAVI-INVESTGN-005C counts through it — and it is
    // added to no response of investigation, whose HTTP contract does not change
    Investigation.hasMany(InvestigationTeamMember, { foreignKey: 'investigationId', as: 'teamMembers' });
}
