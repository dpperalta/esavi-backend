import { SystemConfig } from '../systemConfig.model';
import { SystemConfigHistory } from '../systemConfigHistory.model';
import { AppUser } from '../appUser.model';

export const initSystemConfigAssociations = (): void => {
    // Parent -> child. A configuration accumulates one history row per real change of its value, so
    // hasMany is the only possible cardinality
    SystemConfig.hasMany(SystemConfigHistory, { foreignKey: 'systemConfigId', as: 'history' });
    SystemConfigHistory.belongsTo(SystemConfig, { foreignKey: 'systemConfigId', as: 'config' });

    // The author of the change. changedByUser is the alias the include of the ESAVI-SYSCONF-007 uses,
    // pulling only userId and displayName — the rest of appUser is PII an audit screen does not need,
    // and displayName still has to be decrypted with esaviDecrypt before answering.
    // It is declared here and not in appUser.associations.ts because the key belongs to
    // systemConfigHistory. Nullable by ON DELETE SET NULL: a row whose author was deleted answers
    // changedByUser: null
    SystemConfigHistory.belongsTo(AppUser, { foreignKey: 'changedByUserId', as: 'changedByUser' });
}
